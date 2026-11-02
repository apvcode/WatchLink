import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildAuthUrl,
  createPkce,
  type FetchLike,
  GoogleAuth,
  GoogleAuthError,
  type StoredTokens,
  type TokenStore,
} from '../../apps/desktop/src/google-auth';

function memoryStore(
  initial: StoredTokens | null = null,
): TokenStore & { value: StoredTokens | null } {
  const store = {
    value: initial,
    load: async () => store.value,
    save: async (tokens: StoredTokens) => {
      store.value = tokens;
    },
    clear: async () => {
      store.value = null;
    },
  };
  return store;
}

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** Fake Google: records every call and answers token / userinfo / revoke requests. */
function fakeGoogle(handlers: { token?: (form: URLSearchParams) => ReturnType<typeof json> } = {}) {
  const calls: Array<{ url: string; form: URLSearchParams }> = [];
  const fetch: FetchLike = async (url, init) => {
    const form = new URLSearchParams(init?.body ?? '');
    calls.push({ url, form });
    if (url.includes('/token'))
      return (
        handlers.token?.(form) ??
        json(200, {
          access_token: `access-${calls.length}`,
          expires_in: 3600,
          refresh_token: 'refresh-1',
          scope: 'drive.readonly',
        })
      );
    if (url.includes('userinfo'))
      return json(200, { email: 'a@b.c', name: 'Alex', picture: 'https://p/x.png' });
    return json(200, {});
  };
  return { fetch, calls };
}

describe('PKCE and authorization URL', () => {
  it('derives the S256 challenge from the verifier', () => {
    const { verifier, challenge } = createPkce();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it('asks for offline access, consent and read-only Drive', () => {
    const url = new URL(
      buildAuthUrl({
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:1/oauth2callback',
        challenge: 'ch',
        state: 'st',
        loginHint: 'a@b.c',
      }),
    );
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('auth/drive.readonly');
    expect(url.searchParams.get('login_hint')).toBe('a@b.c');
  });
});

describe('GoogleAuth sign-in', () => {
  it('completes the loopback flow and stores tokens and profile', async () => {
    const { fetch, calls } = fakeGoogle();
    const store = memoryStore();
    const auth = new GoogleAuth({
      clientId: 'cid',
      clientSecret: 'secret',
      store,
      fetch,
      // The "browser": follow the consent URL and hit the loopback redirect with the same state.
      openBrowser: async (url) => {
        const auth = new URL(url);
        const redirect = new URL(auth.searchParams.get('redirect_uri') as string);
        redirect.searchParams.set('code', 'the-code');
        redirect.searchParams.set('state', auth.searchParams.get('state') as string);
        const page = await globalThis.fetch(redirect);
        expect(page.status).toBe(200);
      },
    });
    const status = await auth.signIn();
    expect(status).toMatchObject({ linked: true, needsRelink: false });
    expect(status.profile?.email).toBe('a@b.c');
    expect(store.value?.refreshToken).toBe('refresh-1');
    const exchange = calls.find((c) => c.form.get('grant_type') === 'authorization_code');
    expect(exchange?.form.get('code')).toBe('the-code');
    expect(exchange?.form.get('code_verifier')).toBeTruthy();
    expect(exchange?.form.get('client_secret')).toBe('secret');
  });

  it('rejects a redirect whose state does not match', async () => {
    const { fetch, calls } = fakeGoogle();
    const auth = new GoogleAuth({
      clientId: 'cid',
      store: memoryStore(),
      fetch,
      openBrowser: async (url) => {
        const redirect = new URL(new URL(url).searchParams.get('redirect_uri') as string);
        redirect.searchParams.set('code', 'evil');
        redirect.searchParams.set('state', 'forged');
        await globalThis.fetch(redirect);
      },
    });
    await expect(auth.signIn()).rejects.toMatchObject({ code: 'exchange' });
    expect(calls.some((c) => c.form.get('code') === 'evil')).toBe(false);
  });

  it('reports a denied consent screen', async () => {
    const auth = new GoogleAuth({
      clientId: 'cid',
      store: memoryStore(),
      fetch: fakeGoogle().fetch,
      openBrowser: async (url) => {
        const redirect = new URL(new URL(url).searchParams.get('redirect_uri') as string);
        redirect.searchParams.set('error', 'access_denied');
        await globalThis.fetch(redirect);
      },
    });
    await expect(auth.signIn()).rejects.toMatchObject({ code: 'denied' });
  });

  it('can be cancelled while waiting for the browser', async () => {
    const auth = new GoogleAuth({
      clientId: 'cid',
      store: memoryStore(),
      fetch: fakeGoogle().fetch,
      openBrowser: () => undefined,
    });
    const attempt = auth.signIn();
    await new Promise((resolve) => setTimeout(resolve, 50));
    auth.cancelSignIn();
    await expect(attempt).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('GoogleAuth session', () => {
  const stored = (expiresAt: number): StoredTokens => ({
    refreshToken: 'refresh-1',
    accessToken: 'cached',
    expiresAt,
    profile: { email: 'a@b.c', name: 'Alex' },
  });

  it('serves the cached token while it is fresh', async () => {
    const { fetch, calls } = fakeGoogle();
    const auth = new GoogleAuth({
      clientId: 'c',
      store: memoryStore(stored(10_000_000)),
      fetch,
      openBrowser: () => undefined,
      now: () => 0,
    });
    expect(await auth.getAccessToken()).toBe('cached');
    expect(calls).toHaveLength(0);
  });

  it('refreshes silently near expiry, once for concurrent callers', async () => {
    const { fetch, calls } = fakeGoogle();
    const store = memoryStore(stored(60_000));
    const auth = new GoogleAuth({
      clientId: 'c',
      store,
      fetch,
      openBrowser: () => undefined,
      now: () => 0,
    });
    const tokens = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
    expect(tokens[0]).toBe(tokens[1]);
    expect(tokens[0]).not.toBe('cached');
    expect(calls.filter((c) => c.form.get('grant_type') === 'refresh_token')).toHaveLength(1);
    expect(store.value?.refreshToken).toBe('refresh-1');
  });

  it('asks to link again when Google rejects the refresh token', async () => {
    const { fetch } = fakeGoogle({ token: () => json(400, { error: 'invalid_grant' }) });
    const store = memoryStore(stored(0));
    const auth = new GoogleAuth({
      clientId: 'c',
      store,
      fetch,
      openBrowser: () => undefined,
      now: () => 1e9,
    });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'relink' });
    expect(await auth.status()).toMatchObject({ linked: false, needsRelink: true });
  });

  it('keeps the session when the refresh fails only because the network is down', async () => {
    const store = memoryStore(stored(0));
    const auth = new GoogleAuth({
      clientId: 'c',
      store,
      fetch: async () => {
        throw new Error('offline');
      },
      openBrowser: () => undefined,
      now: () => 1e9,
    });
    await expect(auth.getAccessToken()).rejects.toThrow('offline');
    expect(store.value?.refreshToken).toBe('refresh-1');
    expect((await auth.status()).needsRelink).toBe(false);
  });

  it('refuses to hand out tokens when nothing is linked', async () => {
    const auth = new GoogleAuth({
      clientId: 'c',
      store: memoryStore(),
      fetch: fakeGoogle().fetch,
      openBrowser: () => undefined,
    });
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it('revokes the grant and forgets the tokens on sign-out', async () => {
    const { fetch, calls } = fakeGoogle();
    const store = memoryStore(stored(0));
    const auth = new GoogleAuth({ clientId: 'c', store, fetch, openBrowser: () => undefined });
    await auth.signOut();
    expect(store.value).toBeNull();
    expect(calls.at(-1)?.form.get('token')).toBe('refresh-1');
    expect((await auth.status()).linked).toBe(false);
  });
});
