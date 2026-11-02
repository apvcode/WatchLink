// Local loopback proxy that lets a plain <video> element play a private Drive file.
// <video src> cannot send an Authorization header, so the content view loads
// http://127.0.0.1:<port>/v/<secret>/<fileId> and this server adds the token and forwards Range
// requests to Drive. Nothing is stored or relayed anywhere else: bytes go Drive -> this process
// -> the local player.
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

const ID = /^[\w-]{10,200}$/;
const KEY = /^[\w-]{1,100}$/;
const FORWARD_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
];

export interface DriveProxyOptions {
  getToken: (forceRefresh?: boolean) => Promise<string>;
  fetch?: typeof fetch;
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class DriveProxy {
  readonly secret = randomBytes(18).toString('base64url');
  private server: Server | null = null;
  private port = 0;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DriveProxyOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** Starts listening (once) and returns the page URL that plays the given file. */
  async streamUrl(fileId: string, resourceKey?: string): Promise<string> {
    if (!ID.test(fileId)) throw new Error('bad file id');
    await this.start();
    const rk = resourceKey && KEY.test(resourceKey) ? `?rk=${resourceKey}` : '';
    return `http://127.0.0.1:${this.port}/v/${this.secret}/${fileId}${rk}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private start(): Promise<void> {
    if (this.server) return Promise.resolve();
    const server = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        this.port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const fail = (status: number) => {
      response.writeHead(status, { 'cache-control': 'no-store' }).end();
    };
    // Only the player on this machine may ask (blocks DNS rebinding and other origins).
    if (request.headers.host !== `127.0.0.1:${this.port}`) return fail(403);
    if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405);
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const [, kind, secret, id] = url.pathname.split('/');
    if (secret !== this.secret || !id || !ID.test(id) || (kind !== 'v' && kind !== 'm'))
      return fail(404);
    const rk = url.searchParams.get('rk') ?? undefined;
    if (rk && !KEY.test(rk)) return fail(400);

    if (kind === 'v') {
      const media = `/m/${this.secret}/${id}${rk ? `?rk=${rk}` : ''}`;
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
      });
      response.end(playerPage(media));
      return;
    }

    const controller = new AbortController();
    response.on('close', () => controller.abort());
    const upstream = await this.fetchMedia(id, rk, request.headers.range, controller.signal);
    const headers: Record<string, string> = { 'cache-control': 'no-store' };
    for (const name of FORWARD_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    // Drive sometimes labels videos as octet-stream; the element sniffs the container itself.
    headers['accept-ranges'] ??= 'bytes';
    response.writeHead(upstream.status, headers);
    if (request.method === 'HEAD' || !upstream.body) return void response.end();
    Readable.fromWeb(upstream.body as never)
      .on('error', () => response.destroy())
      .pipe(response);
  }

  private async fetchMedia(
    id: string,
    resourceKey: string | undefined,
    range: string | undefined,
    signal: AbortSignal,
  ): Promise<Response> {
    for (const force of [false, true]) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${await this.options.getToken(force)}`,
      };
      if (range) headers.range = range;
      if (resourceKey) headers['x-goog-drive-resource-keys'] = `${id}/${resourceKey}`;
      const response = await this.fetchImpl(
        `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true&acknowledgeAbuse=false`,
        { headers, signal },
      );
      if (response.status === 401 && !force) continue;
      return response;
    }
    throw new Error('unauthorized');
  }
}

function playerPage(mediaPath: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WatchLink</title>
<style>html,body{margin:0;height:100%;background:#000}video{width:100%;height:100%;object-fit:contain;background:#000}
#e{position:fixed;inset:0;display:none;place-items:center;color:#aaa;font:15px system-ui,sans-serif;text-align:center;padding:24px}</style>
<video id="v" src="${escapeHtml(mediaPath)}" autoplay playsinline controls></video>
<div id="e"></div>
<script>
var v=document.getElementById('v'),e=document.getElementById('e');
v.addEventListener('error',function(){var c=v.error&&v.error.code;
e.textContent=c===4?'Формат не поддерживается этим устройством / Unsupported video format':'Не удалось воспроизвести видео / Playback failed';
e.style.display='grid';});
</script>`;
}
