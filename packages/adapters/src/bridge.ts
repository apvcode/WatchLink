import { installVideoSurface } from './presentation.js';
import { attachAdapter } from './registry.js';
import type { BridgeToHostMessage, HostToBridgeMessage, PlayerController } from './types.js';

/**
 * Runs in the page's own JS world. YouTube's resize handler compares the window area with the
 * screen area and, below ~1/3, decides the player is minimised (picture-in-picture): it pauses
 * the video and keeps pausing every play attempt. The content view is only a small rectangle
 * (and resizes when the host toggles fullscreen), so report the screen size as the window size.
 */
export function pinOuterWindowSize(w: Window): void {
  for (const [prop, dim] of [
    ['outerWidth', 'width'],
    ['outerHeight', 'height'],
  ] as const) {
    try {
      Object.defineProperty(w, prop, { configurable: true, get: () => w.screen[dim] });
    } catch {
      /* ignore */
    }
  }
}

export class ContentBridge {
  private win: Window;
  private controller: PlayerController | null = null;
  private adapterId = 'none';
  private isDisposed = false;
  private listener: ((ev: MessageEvent) => void) | null = null;
  private noVideoTimer: ReturnType<typeof setTimeout> | null = null;
  private ambientTimer: ReturnType<typeof setInterval> | null = null;
  private ambientEnabled = true;

  constructor(win: Window) {
    this.win = win;
  }

  /** Pages pause playback on visibilitychange; make them think they stay visible. */
  private keepAliveInBackground(): void {
    try {
      const doc = this.win.document;
      Object.defineProperty(doc, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'visible' });
      this.win.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
      doc.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
    } catch {
      /* ignore */
    }
  }

  /** The adapter runs in an isolated world on desktop: the page only sees main-world changes. */
  private pinWindowSize(): void {
    const w = this.win as unknown as { __watchlink_main?: (code: string) => Promise<unknown> };
    if (typeof w.__watchlink_main === 'function')
      void w.__watchlink_main(`(${pinOuterWindowSize.toString()})(window)`);
    else pinOuterWindowSize(this.win);
  }

  public init(): void {
    installVideoSurface(this.win);
    this.keepAliveInBackground();
    this.pinWindowSize();
    const result = attachAdapter(this.win);
    if (!result) {
      this.postToHost({
        type: 'watchlink:no-video',
        url: this.win.location?.href || '',
      });
      return;
    }

    this.controller = result.controller;
    this.adapterId = result.adapter.id;

    this.noVideoTimer = setTimeout(() => {
      if (!this.win.document.querySelector('video'))
        this.postToHost({ type: 'watchlink:no-video', url: this.win.location.href });
    }, 15000);
    // Send ready message
    this.postToHost({
      type: 'watchlink:ready',
      adapterId: this.adapterId,
      url: this.win.location?.href || '',
    });

    // Send initial state
    this.postToHost({
      type: 'watchlink:state',
      state: this.controller.getState(),
    });

    // Listen for state changes
    this.controller.onState((state) => {
      this.postToHost({
        type: 'watchlink:state',
        state,
      });
    });

    // Listen for discrete events
    this.controller.onEvent((event) => {
      this.postToHost({
        type: 'watchlink:event',
        event,
      });
    });

    this.setupHostListener();
    this.startAmbient();
  }

  /** Samples the picture's edge colours (top/right/bottom/left) for the ambient glow. */
  private setAmbient(on: boolean): void {
    this.ambientEnabled = on;
    if (on) {
      if (!this.ambientTimer) this.startAmbient();
    } else {
      if (this.ambientTimer) clearInterval(this.ambientTimer);
      this.ambientTimer = null;
      this.postToHost({ type: 'watchlink:ambient', colors: null });
    }
  }

  private startAmbient(): void {
    if (!this.ambientEnabled) return;
    const doc = this.win.document;
    const canvas = doc.createElement('canvas');
    canvas.width = 16;
    canvas.height = 9;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    let last = '';
    const avg = (data: Uint8ClampedArray, cells: number[]): [number, number, number] => {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const c of cells) {
        r += data[c * 4] ?? 0;
        g += data[c * 4 + 1] ?? 0;
        b += data[c * 4 + 2] ?? 0;
      }
      const n = cells.length || 1;
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    };
    const tick = () => {
      const v = Array.from(doc.querySelectorAll('video')).find(
        (el) => el.videoWidth > 0 && el.readyState >= 2 && !el.paused,
      );
      if (!v) return;
      try {
        ctx.drawImage(v, 0, 0, 16, 9);
        const { data } = ctx.getImageData(0, 0, 16, 9);
        const idx = (x0: number, x1: number, y0: number, y1: number) => {
          const out: number[] = [];
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push(y * 16 + x);
          return out;
        };
        const colors = [
          avg(data, idx(0, 16, 0, 2)),
          avg(data, idx(13, 16, 0, 9)),
          avg(data, idx(0, 16, 7, 9)),
          avg(data, idx(0, 3, 0, 9)),
        ] as Array<[number, number, number]>;
        const key = colors.map((c) => c.map((n) => n >> 3).join(',')).join('|');
        if (key === last) return;
        last = key;
        this.postToHost({ type: 'watchlink:ambient', colors });
      } catch {
        // Tainted (cross-origin) video: no glow for this source.
        if (this.ambientTimer) clearInterval(this.ambientTimer);
        this.ambientTimer = null;
        this.postToHost({ type: 'watchlink:ambient', colors: null });
      }
    };
    // Reading pixels back from a hardware-decoded video stalls the GPU: keep it rare.
    this.ambientTimer = setInterval(tick, 1800);
  }

  private postToHost(message: BridgeToHostMessage): void {
    if (this.isDisposed) return;
    if (message.type === 'watchlink:state') {
      const title = (this.win.document?.title ?? '')
        .replace(/\s*[-–|]\s*YouTube\s*$/i, '')
        .replace(/^\(\d+\)\s*/, '')
        .trim()
        .slice(0, 160);
      const state = { ...message.state, title };
      // Host IPC drops messages over 8 KB: shed the biggest optional payloads first.
      if (JSON.stringify(state).length > 7000)
        state.captionTracks = state.captionTracks?.slice(0, 8);
      if (JSON.stringify(state).length > 7000) state.audioTracks = state.audioTracks?.slice(0, 6);
      message = { ...message, state };
    }

    // 1. Android WebViewCompat bridge
    const androidBridge = (
      this.win as unknown as { WatchLinkBridge?: { postMessage: (msg: string) => void } }
    ).WatchLinkBridge;
    if (androidBridge && typeof androidBridge.postMessage === 'function') {
      try {
        androidBridge.postMessage(JSON.stringify(message));
      } catch (err) {
        console.error('[WatchLink:Bridge] Android postMessage error:', err);
      }
    }

    // 2a. Electron: isolated-world IPC hook, invisible to (and unforgeable by) the page
    const direct = (this.win as unknown as { __watchlink_send?: (msg: unknown) => void })
      .__watchlink_send;
    if (typeof direct === 'function') {
      try {
        direct(message);
      } catch (err) {
        console.error('[WatchLink:Bridge] IPC send error:', err);
      }
      return;
    }

    // 2b. Window postMessage bridge
    try {
      this.win.postMessage(message, '*');
      if (this.win.parent && this.win.parent !== this.win) {
        this.win.parent.postMessage(message, '*');
      }
    } catch (err) {
      console.error('[WatchLink:Bridge] Window postMessage error:', err);
    }
  }

  private setupHostListener(): void {
    const handleIncoming = (raw: unknown) => {
      let data: HostToBridgeMessage | null = null;
      if (typeof raw === 'string') {
        try {
          data = JSON.parse(raw);
        } catch {
          return;
        }
      } else if (raw && typeof raw === 'object') {
        data = raw as HostToBridgeMessage;
      }

      if (!data?.type?.startsWith('watchlink:')) {
        return;
      }

      this.handleCommand(data);
    };

    // Listen on window.addEventListener('message')
    this.listener = (ev: MessageEvent) => {
      if (ev.source === this.win) handleIncoming(ev.data);
    };
    this.win.addEventListener('message', this.listener);

    // Listen on Android bridge onmessage if available
    const androidBridge = (
      this.win as unknown as { WatchLinkBridge?: { onmessage?: (ev: { data: string }) => void } }
    ).WatchLinkBridge;
    if (androidBridge) {
      androidBridge.onmessage = (ev: { data: string }) => {
        handleIncoming(ev.data);
      };
    }
  }

  public handleCommand(cmd: HostToBridgeMessage): void {
    if (!this.controller) return;

    switch (cmd.type) {
      case 'watchlink:cmd:play':
        this.controller.play();
        break;
      case 'watchlink:cmd:pause':
        this.controller.pause();
        break;
      case 'watchlink:cmd:seek':
        if (typeof cmd.position === 'number') {
          this.controller.seek(cmd.position);
        }
        break;
      case 'watchlink:cmd:rate':
        if (typeof cmd.rate === 'number') {
          this.controller.setRate(cmd.rate);
        }
        break;
      case 'watchlink:cmd:quality':
        if (typeof cmd.quality === 'string' && /^[a-z0-9]{2,12}$/.test(cmd.quality)) {
          this.controller.setQuality?.(cmd.quality);
        }
        break;
      case 'watchlink:cmd:audio':
        if (typeof cmd.id === 'string' && /^[A-Za-z0-9_;.:=+/-]{1,160}$/.test(cmd.id))
          this.controller.setAudioTrack?.(cmd.id);
        break;
      case 'watchlink:cmd:captions':
        if (typeof cmd.id === 'string' && /^[A-Za-z0-9_.@-]{1,40}$/.test(cmd.id))
          this.controller.setCaptionTrack?.(cmd.id);
        break;
      case 'watchlink:cmd:ambient':
        this.setAmbient(cmd.on === true);
        break;
      case 'watchlink:cmd:getState':
        this.postToHost({
          type: 'watchlink:state',
          state: this.controller.getState(),
        });
        break;
      case 'watchlink:ping':
        this.postToHost({ type: 'watchlink:pong' });
        break;
    }
  }

  public getController(): PlayerController | null {
    return this.controller;
  }

  public getAdapterId(): string {
    return this.adapterId;
  }

  public dispose(): void {
    this.isDisposed = true;
    if (this.listener) this.win.removeEventListener('message', this.listener);
    if (this.noVideoTimer) clearTimeout(this.noVideoTimer);
    if (this.ambientTimer) clearInterval(this.ambientTimer);
    if (this.controller) {
      this.controller.dispose();
      this.controller = null;
    }
  }
}

/**
 * Self-initializes the bridge if running in a browser / frame window.
 */
export function injectBridge(win: Window = window): ContentBridge {
  const bridge = new ContentBridge(win);
  bridge.init();
  return bridge;
}

// Auto-initialize if running in a window environment
if (typeof window !== 'undefined') {
  const init = () => {
    const w = window as unknown as { __watchlink_bridge__?: ContentBridge };
    if (!w.__watchlink_bridge__) {
      w.__watchlink_bridge__ = injectBridge(window);
    }
  };
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}
