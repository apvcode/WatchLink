import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildQuery,
  DriveClient,
  DriveError,
  driveFileId,
  quote,
  toDriveFile,
} from '../../apps/desktop/src/drive';
import { DriveProxy } from '../../apps/desktop/src/drive-proxy';

const FILE_ID = 'abcDEF123_-xyz789';

describe('Drive queries', () => {
  it('lists the root of My Drive by default and folders by id', () => {
    expect(buildQuery({ view: 'mine' }).q).toContain("'root' in parents");
    expect(buildQuery({ view: 'mine', folderId: 'f1' }).q).toContain("'f1' in parents");
    expect(buildQuery({ view: 'mine' }).q).toContain("mimeType contains 'video/'");
  });

  it('escapes quotes and backslashes in search text', () => {
    expect(quote("it's a\\b")).toBe("'it\\'s a\\\\b'");
    expect(buildQuery({ view: 'search', query: "x' or 1=1" }).q).toContain("'x\\' or 1=1'");
  });

  it('has views for shared and recent files', () => {
    expect(buildQuery({ view: 'shared' }).q).toContain('sharedWithMe = true');
    expect(buildQuery({ view: 'recent' }).orderBy).toContain('viewedByMeTime');
  });
});

describe('Drive file mapping', () => {
  const base = { id: 'i', name: 'n.mp4', mimeType: 'video/mp4' };
  it('detects link sharing, private files and unknown access', () => {
    expect(toDriveFile({ ...base, permissions: [{ type: 'anyone', role: 'reader' }] }).access).toBe(
      'link',
    );
    expect(
      toDriveFile({ ...base, ownedByMe: true, permissions: [{ type: 'user', role: 'owner' }] })
        .access,
    ).toBe('private');
    expect(toDriveFile({ ...base, ownedByMe: false }).access).toBe('unknown');
    expect(toDriveFile(base).access).toBe('unknown');
  });

  it('converts sizes, durations and folders', () => {
    const file = toDriveFile({
      ...base,
      size: '1048576',
      videoMediaMetadata: { durationMillis: '61000', width: 1920, height: 1080 },
    });
    expect(file).toMatchObject({ size: 1048576, durationMs: 61000, width: 1920, isFolder: false });
    expect(toDriveFile({ ...base, mimeType: 'application/vnd.google-apps.folder' }).isFolder).toBe(
      true,
    );
  });

  it('extracts ids from share links only on Google hosts', () => {
    expect(driveFileId(`https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`)).toBe(
      FILE_ID,
    );
    expect(driveFileId(`https://drive.google.com/open?id=${FILE_ID}`)).toBe(FILE_ID);
    expect(driveFileId('https://evil.example/file/d/abc/view')).toBeUndefined();
    expect(driveFileId('not a url')).toBeUndefined();
  });
});

describe('DriveClient', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('sends the bearer token and maps results', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const client = new DriveClient(
      async () => 'tok',
      async (url, init) => {
        seen.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
        return json(200, {
          files: [{ id: 'a', name: 'x.mp4', mimeType: 'video/mp4' }],
          nextPageToken: 'n',
        });
      },
    );
    const result = await client.list({ view: 'mine', pageToken: 'p' });
    expect(result.files[0]?.name).toBe('x.mp4');
    expect(result.nextPageToken).toBe('n');
    expect(seen[0]?.auth).toBe('Bearer tok');
    expect(seen[0]?.url).toContain('pageToken=p');
  });

  it('refreshes the token once on 401, then gives up with the status', async () => {
    const forced: boolean[] = [];
    let calls = 0;
    const client = new DriveClient(
      async (force) => {
        forced.push(Boolean(force));
        return 't';
      },
      async () => (++calls === 1 ? json(401, {}) : json(200, { files: [] })),
    );
    await client.list({ view: 'recent' });
    expect(forced).toEqual([false, true]);

    const denied = new DriveClient(
      async () => 't',
      async () => json(403, {}),
    );
    await expect(denied.list({ view: 'recent' })).rejects.toMatchObject({ status: 403 });
    await expect(denied.list({ view: 'recent' })).rejects.toBeInstanceOf(DriveError);
  });
});

describe('DriveClient sharing', () => {
  it('opens link sharing without listing the file in search', async () => {
    const seen: Array<{ url: string; method?: string; body?: string }> = [];
    const client = new DriveClient(
      async () => 't',
      async (url, init) => {
        seen.push({ url: String(url), method: init?.method, body: String(init?.body) });
        return new Response('{}', { status: 200 });
      },
    );
    await client.makePublic(FILE_ID);
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.url).toContain(`/files/${FILE_ID}/permissions`);
    expect(JSON.parse(seen[0]?.body ?? '{}')).toEqual({
      type: 'anyone',
      role: 'reader',
      allowFileDiscovery: false,
    });
  });

  it('closes link sharing by deleting the anyone permission', async () => {
    const seen: Array<{ url: string; method?: string }> = [];
    const client = new DriveClient(
      async () => 't',
      async (url, init) => {
        seen.push({ url: String(url), method: init?.method });
        return new Response(null, { status: 204 });
      },
    );
    await client.makePrivate(FILE_ID);
    expect(seen[0]).toMatchObject({ method: 'DELETE' });
    expect(seen[0]?.url).toContain('/permissions/anyoneWithLink');
  });

  it('surfaces a refusal (not the owner) with its status', async () => {
    const client = new DriveClient(
      async () => 't',
      async () => new Response('{}', { status: 403 }),
    );
    await expect(client.makePublic(FILE_ID)).rejects.toMatchObject({ status: 403 });
  });
});

describe('DriveProxy', () => {
  let proxy: DriveProxy | null = null;
  afterEach(async () => {
    await proxy?.stop();
    proxy = null;
  });

  function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const upstream: Array<{ url: string; headers: Headers }> = [];
    const tokens: boolean[] = [];
    proxy = new DriveProxy({
      getToken: async (force) => {
        tokens.push(Boolean(force));
        return force ? 'fresh' : 'stale';
      },
      fetch: async (url, init) => {
        upstream.push({ url: String(url), headers: new Headers(init?.headers) });
        return handler(String(url), init ?? {});
      },
    });
    return { upstream, tokens };
  }

  it('serves a player page and streams the file with Range and the token', async () => {
    const { upstream } = setup(
      () =>
        new Response('PARTIAL', {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-range': 'bytes 0-6/100',
            'content-length': '7',
          },
        }),
    );
    const url = await proxy!.streamUrl(FILE_ID, 'rk_1');
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`/m/${proxy!.secret}/${FILE_ID}?rk=rk_1`);

    const media = await fetch(url.replace('/v/', '/m/'), { headers: { range: 'bytes=0-6' } });
    expect(media.status).toBe(206);
    expect(media.headers.get('content-range')).toBe('bytes 0-6/100');
    expect(await media.text()).toBe('PARTIAL');
    expect(upstream[0]?.url).toContain(`/files/${FILE_ID}?alt=media`);
    expect(upstream[0]?.headers.get('authorization')).toBe('Bearer stale');
    expect(upstream[0]?.headers.get('range')).toBe('bytes=0-6');
    expect(upstream[0]?.headers.get('x-goog-drive-resource-keys')).toBe(`${FILE_ID}/rk_1`);
  });

  it('retries once with a fresh token after a 401', async () => {
    let calls = 0;
    const { upstream, tokens } = setup(() =>
      ++calls === 1 ? new Response('', { status: 401 }) : new Response('ok'),
    );
    const url = await proxy!.streamUrl(FILE_ID);
    const res = await fetch(url.replace('/v/', '/m/'));
    expect(await res.text()).toBe('ok');
    expect(tokens).toEqual([false, true]);
    expect(upstream[1]?.headers.get('authorization')).toBe('Bearer fresh');
  });

  it('passes upstream errors such as 403 through', async () => {
    setup(() => new Response('no', { status: 403 }));
    const url = await proxy!.streamUrl(FILE_ID);
    expect((await fetch(url.replace('/v/', '/m/'))).status).toBe(403);
  });

  it('rejects a wrong secret, bad ids, unsupported methods and foreign Host headers', async () => {
    const { upstream } = setup(() => new Response('x'));
    const url = new URL(await proxy!.streamUrl(FILE_ID));
    const base = `http://127.0.0.1:${url.port}`;
    expect((await fetch(`${base}/m/wrong/${FILE_ID}`)).status).toBe(404);
    expect((await fetch(`${base}/m/${proxy!.secret}/short`)).status).toBe(404);
    expect((await fetch(`${base}/x/${proxy!.secret}/${FILE_ID}`)).status).toBe(404);
    expect((await fetch(`${base}/m/${proxy!.secret}/${FILE_ID}`, { method: 'POST' })).status).toBe(
      405,
    );
    const foreign = await new Promise<number>((resolve) => {
      httpRequest(
        {
          host: '127.0.0.1',
          port: url.port,
          path: url.pathname,
          headers: { host: 'evil.example' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      ).end();
    });
    expect(foreign).toBe(403);
    expect(upstream).toHaveLength(0);
  });

  it('refuses ids that are not Drive ids', async () => {
    setup(() => new Response('x'));
    await expect(proxy!.streamUrl('../etc/passwd')).rejects.toThrow();
  });
});
