export interface HostMessage {
  type: string;
  [key: string]: any;
}
export interface HostBridge {
  send(message: HostMessage): void;
  subscribe(listener: (message: HostMessage) => void): () => void;
}
declare global {
  interface Window {
    watchlinkHost?: HostBridge;
    WatchLinkHost?: { postMessage(message: string): void };
  }
}
export const host: HostBridge = window.watchlinkHost ?? {
  send(message) {
    window.WatchLinkHost?.postMessage(JSON.stringify(message));
  },
  subscribe(listener) {
    const handler = (event: MessageEvent) => {
      if (event.source === window && event.data && typeof event.data.type === 'string')
        listener(event.data);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  },
};
export function normalizeSource(raw: string): string {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol))
    throw new Error('Only HTTP/HTTPS video URLs are supported');
  if (url.hostname === 'drive.google.com') {
    const id = url.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? url.searchParams.get('id');
    if (id) return `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
  }
  return url.href;
}

/** The Android app (no desktop host bridge). The video glow is desktop-only. */
export const isPhone = !window.watchlinkHost;
