// Google sign-in for the desktop app: OAuth 2.0 authorization-code flow with PKCE over a
// loopback redirect (RFC 8252), in the system browser. Google blocks sign-in inside embedded
// web views, so the app never renders Google's login page itself.
//
// This file must not import "electron" so it stays unit-testable; the host injects the browser
// opener and the token store.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.readonly',
];
/** Needed only to change a file's sharing; requested on demand, never at first sign-in. */
export const DRIVE_FULL_SCOPE = 'https://www.googleapis.com/auth/drive';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REFRESH_MARGIN_MS = 5 * 60_000;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}
export interface StoredTokens {
  refreshToken: string;
  accessToken?: string;
  /** Epoch ms when accessToken stops being valid. */
  expiresAt?: number;
  scope?: string;
  profile?: GoogleProfile;
}
export interface TokenStore {
  load(): Promise<StoredTokens | null>;
  save(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}
export interface GoogleStatus {
  linked: boolean;
  /** The refresh token was rejected (revoked or expired): the user has to link again. */
  needsRelink: boolean;
  profile?: GoogleProfile;
}
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GoogleAuthOptions {
  clientId: string;
  clientSecret?: string;
  store: TokenStore;
  openBrowser: (url: string) => void | Promise<void>;
  fetch?: FetchLike;
  now?: () => number;
}

export class GoogleAuthError extends Error {
  constructor(
    readonly code: 'cancelled' | 'timeout' | 'denied' | 'exchange' | 'not-linked' | 'relink',
    message?: string,
  ) {
    super(message ?? code);
  }
}

const b64url = (buffer: Buffer): string => buffer.toString('base64url');

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export function buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  loginHint?: string;
  extraScopes?: string[];
}): string {
  const url = new URL(AUTH_URL);
  const query: Record<string, string> = {
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: [...GOOGLE_SCOPES, ...(params.extraScopes ?? [])].join(' '),
    // keep what the user already granted when asking for one more permission
    include_granted_scopes: 'true',
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    state: params.state,
    // "offline" + "consent" guarantees a refresh token, which keeps the session alive indefinitely.
    access_type: 'offline',
    prompt: 'consent',
  };
  if (params.loginHint) query.login_hint = params.loginHint;
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.href;
}

const PAGE = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WatchLink</title>
<style>html{background:#000;color:#fff;font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;height:100%}
main{text-align:center;max-width:22rem;padding:1rem}h1{font-size:1.4rem;margin:.6rem 0}p{color:#9a9a9a;margin:0}
i{display:inline-grid;place-items:center;width:56px;height:56px;border-radius:16px;background:#fff;color:#000;font-style:normal;font-size:26px}</style>
<main><i>▶</i><h1>${title}</h1><p>${text}</p></main>`;

export class GoogleAuth {
  private readonly http: FetchLike;
  private readonly now: () => number;
  private refreshing: Promise<StoredTokens> | null = null;
  private relink = false;
  private pending: { server: Server; reject: (error: GoogleAuthError) => void } | null = null;

  constructor(private readonly options: GoogleAuthOptions) {
    this.http = options.fetch ?? (fetch as unknown as FetchLike);
    this.now = options.now ?? Date.now;
  }

  async status(): Promise<GoogleStatus> {
    const tokens = await this.options.store.load();
    return { linked: Boolean(tokens), needsRelink: this.relink, profile: tokens?.profile };
  }

  /** Opens the system browser, waits for the redirect, stores the tokens. */
  async signIn(extraScopes: string[] = []): Promise<GoogleStatus> {
    this.cancelSignIn();
    const { verifier, challenge } = createPkce();
    const state = b64url(randomBytes(16));
    const existing = await this.options.store.load();

    const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>(
      (resolve, reject) => {
        const server = createServer((request, response) => {
          const url = new URL(request.url ?? '/', 'http://127.0.0.1');
          if (url.pathname !== '/oauth2callback') {
            response.writeHead(404).end();
            return;
          }
          const error = url.searchParams.get('error');
          const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end(
            ok
              ? PAGE(
                  'Готово / Done',
                  'Можно закрыть вкладку и вернуться в WatchLink. / You can close this tab.',
                )
              : PAGE(
                  'Не получилось / Failed',
                  'Вернитесь в WatchLink и попробуйте ещё раз. / Go back to WatchLink and try again.',
                ),
          );
          if (error) done(new GoogleAuthError('denied', error));
          else if (!ok) done(new GoogleAuthError('exchange', 'state mismatch'));
          else
            done(undefined, {
              code: url.searchParams.get('code') as string,
              redirectUri: `http://127.0.0.1:${(server.address() as { port: number }).port}/oauth2callback`,
            });
        });
        const timer = setTimeout(() => done(new GoogleAuthError('timeout')), SIGN_IN_TIMEOUT_MS);
        let finished = false;
        const done = (error?: GoogleAuthError, value?: { code: string; redirectUri: string }) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          this.pending = null;
          server.close();
          server.closeAllConnections?.();
          if (error) reject(error);
          else resolve(value as { code: string; redirectUri: string });
        };
        this.pending = { server, reject: (error) => done(error) };
        server.once('error', () => done(new GoogleAuthError('exchange', 'loopback unavailable')));
        server.listen(0, '127.0.0.1', () => {
          const port = (server.address() as { port: number }).port;
          const url = buildAuthUrl({
            clientId: this.options.clientId,
            redirectUri: `http://127.0.0.1:${port}/oauth2callback`,
            challenge,
            state,
            loginHint: existing?.profile?.email,
            extraScopes,
          });
          Promise.resolve(this.options.openBrowser(url)).catch(() =>
            done(new GoogleAuthError('exchange', 'cannot open browser')),
          );
        });
      },
    );

    const token = await this.postToken({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    const refreshToken = token.refresh_token ?? existing?.refreshToken;
    if (!refreshToken) throw new GoogleAuthError('exchange', 'no refresh token');
    const tokens: StoredTokens = {
      refreshToken,
      accessToken: token.access_token,
      expiresAt: this.now() + token.expires_in * 1000,
      scope: token.scope,
    };
    tokens.profile = await this.fetchProfile(token.access_token).catch(() => existing?.profile);
    await this.options.store.save(tokens);
    this.relink = false;
    return this.status();
  }

  /** Whether the saved grant includes the given scope. */
  async hasScope(scope: string): Promise<boolean> {
    const tokens = await this.options.store.load();
    return Boolean(tokens?.scope?.split(' ').includes(scope));
  }

  cancelSignIn(): void {
    this.pending?.reject(new GoogleAuthError('cancelled'));
  }

  /** A valid access token, refreshed silently when it is about to expire. */
  async getAccessToken(forceRefresh = false): Promise<string> {
    const tokens = await this.options.store.load();
    if (!tokens) throw new GoogleAuthError('not-linked');
    if (
      !forceRefresh &&
      tokens.accessToken &&
      (tokens.expiresAt ?? 0) - REFRESH_MARGIN_MS > this.now()
    )
      return tokens.accessToken;
    this.refreshing ??= this.refresh(tokens).finally(() => {
      this.refreshing = null;
    });
    return (await this.refreshing).accessToken as string;
  }

  /** Revokes the grant at Google (best effort) and forgets the tokens. */
  async signOut(): Promise<void> {
    const tokens = await this.options.store.load();
    await this.options.store.clear();
    this.relink = false;
    if (tokens)
      await this.http(REVOKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: tokens.refreshToken }).toString(),
      }).catch(() => undefined);
  }

  private async refresh(tokens: StoredTokens): Promise<StoredTokens> {
    let token: TokenResponse;
    try {
      token = await this.postToken({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      });
    } catch (error) {
      // invalid_grant: revoked, password changed or expired. Keep the profile so the UI can
      // say who has to sign in again; a network error leaves everything as it was.
      if (error instanceof GoogleAuthError && error.code === 'relink') {
        this.relink = true;
        await this.options.store.clear();
      }
      throw error;
    }
    const next: StoredTokens = {
      ...tokens,
      accessToken: token.access_token,
      expiresAt: this.now() + token.expires_in * 1000,
      refreshToken: token.refresh_token ?? tokens.refreshToken,
    };
    await this.options.store.save(next);
    return next;
  }

  private async postToken(form: Record<string, string>): Promise<TokenResponse> {
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      ...(this.options.clientSecret ? { client_secret: this.options.clientSecret } : {}),
      ...form,
    });
    const response = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & {
      error?: string;
    };
    if (!response.ok || !data.access_token) {
      if (data.error === 'invalid_grant') throw new GoogleAuthError('relink', data.error);
      throw new GoogleAuthError('exchange', data.error ?? `HTTP ${response.status}`);
    }
    return data as TokenResponse;
  }

  private async fetchProfile(accessToken: string): Promise<GoogleProfile> {
    const response = await this.http(USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const data = (await response.json()) as { email?: string; name?: string; picture?: string };
    if (!response.ok || !data.email) throw new Error('userinfo');
    return { email: data.email, name: data.name ?? data.email, picture: data.picture };
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}
