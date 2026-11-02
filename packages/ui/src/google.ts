import { useEffect, useState } from 'preact/hooks';
import type { DriveListRequest, DriveListResult } from './drive-links.js';
import { host } from './host.js';

export interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}
export interface GoogleState {
  /** The host has Google sign-in available (client id built in). */
  configured: boolean;
  linked: boolean;
  /** Google rejected the saved session: the user has to link again. */
  needsRelink: boolean;
  /** The system browser is open and we are waiting for the user to finish. */
  linking: boolean;
  profile?: GoogleProfile;
  /** Last link attempt failed (cancelled, denied, ...). */
  error?: string;
}

let state: GoogleState = { configured: false, linked: false, needsRelink: false, linking: false };
const listeners = new Set<() => void>();
const pending = new Map<
  number,
  {
    resolve: (value: never) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
let nextId = 1;
let started = false;
/** The host answered the first status request. Hosts without Google support never answer. */
let statusSeen = false;
let unsupported = false;
let waiters: Array<() => void> = [];
const HOST_ANSWER_MS = 1500;

function flushWaiters(): void {
  const list = waiters;
  waiters = [];
  for (const wake of list) wake();
}

/** Resolves once we know whether the host supports Google (answer or timeout). */
function whenHostKnown(): Promise<void> {
  start();
  if (statusSeen || unsupported) return Promise.resolve();
  return new Promise((resolve) => waiters.push(resolve));
}

function set(patch: Partial<GoogleState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function start(): void {
  if (started) return;
  started = true;
  host.subscribe((message) => {
    if (message.type === 'google:status') {
      statusSeen = true;
      flushWaiters();
      set({
        configured: Boolean(message.configured),
        linked: Boolean(message.linked),
        needsRelink: Boolean(message.needsRelink),
        profile: message.profile,
        linking: false,
        error: message.error,
      });
      return;
    }
    if (
      message.type === 'google:list' ||
      message.type === 'google:stream' ||
      message.type === 'google:share'
    ) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(String(message.error)));
      else request.resolve(message as never);
    }
  });
  host.send({ type: 'google', action: 'status' });
  setTimeout(() => {
    if (statusSeen) return;
    unsupported = true;
    flushWaiters();
  }, HOST_ANSWER_MS);
}

function call<T>(
  action: 'list' | 'stream' | 'share',
  payload: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<T> {
  start();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('timeout'));
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (value: never) => void, reject, timer });
    host.send({ type: 'google', action, id, ...payload });
  });
}

export const google = {
  link(): void {
    start();
    set({ linking: true, error: undefined });
    host.send({ type: 'google', action: 'link' });
  },
  cancel(): void {
    host.send({ type: 'google', action: 'cancel' });
  },
  unlink(): void {
    host.send({ type: 'google', action: 'unlink' });
  },
  list: (request: DriveListRequest): Promise<DriveListResult> =>
    whenHostKnown().then(() =>
      unsupported ? Promise.reject(new Error('not-linked')) : call('list', { ...request }),
    ),
  /** Local player URL for a Drive file; rejects when no account is linked. */
  stream: (url: string): Promise<string> =>
    whenHostKnown().then(() =>
      unsupported || !state.configured || !state.linked
        ? Promise.reject(new Error('not-linked'))
        : call<{ url: string }>('stream', { url }).then((reply) => reply.url),
    ),
  /**
   * Opens (or, with close=true, closes) link sharing for a Drive file. The first time Google asks
   * for a wider permission in the browser, hence the long timeout.
   */
  share: (url: string, close = false): Promise<void> =>
    whenHostKnown().then(() =>
      unsupported
        ? Promise.reject(new Error('unsupported'))
        : call<unknown>('share', { url, close }, 5 * 60_000).then(() => undefined),
    ),
  openExternal(url: string): void {
    host.send({ type: 'open', url });
  },
};

export function useGoogle(): GoogleState {
  const [, rerender] = useState(0);
  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    start();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}
