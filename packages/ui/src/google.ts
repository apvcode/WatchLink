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

function set(patch: Partial<GoogleState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function start(): void {
  if (started) return;
  started = true;
  host.subscribe((message) => {
    if (message.type === 'google:status') {
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
    if (message.type === 'google:list' || message.type === 'google:stream') {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(String(message.error)));
      else request.resolve(message as never);
    }
  });
  host.send({ type: 'google', action: 'status' });
}

function call<T>(action: 'list' | 'stream', payload: Record<string, unknown>): Promise<T> {
  start();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('timeout'));
    }, 30_000);
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
  list: (request: DriveListRequest): Promise<DriveListResult> => call('list', { ...request }),
  /** Local player URL for a Drive file; rejects when no account is linked. */
  stream: (url: string): Promise<string> =>
    call<{ url: string }>('stream', { url }).then((reply) => reply.url),
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
