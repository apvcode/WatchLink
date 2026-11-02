import { findBestVideoElement, GenericVideoController } from './generic.js';
import type { PlayerAdapter, PlayerController, PlayerEvent, PlayerState } from './types.js';

export function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'www.youtube.com' ||
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtu.be'
    );
  } catch {
    return false;
  }
}

/** Runs in the page's own JS world: lets WatchLink veto the page's autoplay while paused. */
function installPlayGuard(w: Window): void {
  const g = w as unknown as {
    __wlGuard?: { block: boolean };
    HTMLMediaElement: { prototype: { play: (...a: unknown[]) => Promise<void> } };
  };
  if (g.__wlGuard) return;
  const guard = { block: false };
  g.__wlGuard = guard;
  const proto = g.HTMLMediaElement.prototype;
  const original = proto.play;
  proto.play = function (this: unknown, ...args: unknown[]) {
    if (guard.block) return Promise.resolve();
    return original.apply(this, args);
  };
}

type TrackInfo = {
  audio: Array<{ id: string; label: string }>;
  cur: string;
  caps: Array<{ id: string; label: string }>;
  capCur: string;
};

/* The page* helpers are self-contained: Electron serialises them into the page's main world. */
function pageReadTracks(p: any, loadCaptions: boolean): TrackInfo | null {
  if (!p) return null;
  const clip = (s: string, n: number) => String(s).slice(0, n);
  const out: TrackInfo = { audio: [], cur: '', caps: [], capCur: 'off' };
  try {
    const tracks = p.getAvailableAudioTracks?.() ?? [];
    out.audio = tracks.slice(0, 40).map((t: any) => {
      let label = '';
      for (const k in t) {
        const v = t[k];
        if (v && typeof v === 'object' && typeof v.name === 'string') {
          label = v.name;
          break;
        }
      }
      return { id: clip(t.id, 120), label: clip(label || t.id, 28) };
    });
    const c = p.getAudioTrack?.();
    out.cur = c ? clip(c.id, 120) : '';
  } catch {}
  try {
    if (loadCaptions) p.loadModule?.('captions');
    const list = p.getOption?.('captions', 'tracklist') ?? [];
    out.caps = list.slice(0, 40).map((t: any) => ({
      id: clip(t.languageCode, 40),
      label: clip(t.displayName || t.languageName || t.languageCode, 28),
    }));
    const cur = p.getOption?.('captions', 'track');
    out.capCur = cur?.languageCode ? clip(cur.languageCode, 40) : 'off';
  } catch {}
  return out;
}
/** Captures the player's own subtitle downloads so WatchLink can render cues itself. */
function pageInstallCapture(): void {
  const w: any = window;
  if (w.__wlCap) return;
  const cap: { v: number; last: string; by: Record<string, Array<[number, number, string]>> } = {
    v: 0,
    last: '',
    by: {},
  };
  w.__wlCap = cap;
  const decode = (t: string) =>
    t
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  const parse = (body: string, url: string) => {
    let lang = '';
    try {
      lang = new URL(url, w.location.href).searchParams.get('lang') || '';
    } catch {}
    const cues: Array<[number, number, string]> = [];
    try {
      if (body.trim().startsWith('{')) {
        for (const e of JSON.parse(body).events || []) {
          if (!e.segs) continue;
          const text = e.segs
            .map((g: any) => g.utf8 || '')
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
          if (text)
            cues.push([e.tStartMs / 1000, (e.tStartMs + (e.dDurationMs || 2500)) / 1000, text]);
        }
      } else {
        const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
        let m: RegExpExecArray | null = re.exec(body);
        while (m) {
          const t = /\bt="(\d+)"/.exec(m[1] as string);
          const d = /\bd="(\d+)"/.exec(m[1] as string);
          const text = decode(m[2] as string);
          if (t && text)
            cues.push([Number(t[1]) / 1000, (Number(t[1]) + Number(d?.[1] ?? 2500)) / 1000, text]);
          m = re.exec(body);
        }
      }
    } catch {}
    if (cues.length) {
      cap.by[lang] = cues;
      cap.last = lang;
      cap.v++;
    }
  };
  const originalFetch = w.fetch;
  w.fetch = function (this: unknown, ...args: any[]) {
    const promise = originalFetch.apply(this, args);
    try {
      const url = String(args[0]?.url ?? args[0]);
      if (url.includes('/api/timedtext'))
        promise
          .then((r: any) =>
            r
              .clone()
              .text()
              .then((b: string) => parse(b, url)),
          )
          .catch(() => {});
    } catch {}
    return promise;
  };
  const open = w.XMLHttpRequest.prototype.open;
  w.XMLHttpRequest.prototype.open = function (this: any, m: string, u: string, ...rest: any[]) {
    if (String(u).includes('/api/timedtext'))
      this.addEventListener('load', () => parse(this.responseText, String(u)));
    return open.call(this, m, u, ...rest);
  };
}
function pageCapVersion(): number {
  return (window as any).__wlCap?.v ?? -1;
}
function pageGetCues(lang: string): Array<[number, number, string]> {
  const cap = (window as any).__wlCap;
  if (!cap) return [];
  const key = cap.by[lang]
    ? lang
    : (Object.keys(cap.by).find((k) => k.startsWith(lang.split('-')[0] as string)) ?? cap.last);
  return (cap.by[key] ?? []).slice(0, 6000);
}
function pageSetAudio(p: any, id: string): void {
  const track = (p?.getAvailableAudioTracks?.() ?? []).find((t: any) => String(t.id) === id);
  if (track) p.setAudioTrack(track);
}
function pageSetCaptions(p: any, id: string): void {
  if (!p) return;
  p.loadModule?.('captions');
  if (id === 'off') {
    p.setOption?.('captions', 'track', {});
    return;
  }
  const list = p.getOption?.('captions', 'tracklist') ?? [];
  const track = list.find((t: any) => t.languageCode === id) ?? { languageCode: id };
  p.setOption?.('captions', 'track', track);
  p.setOption?.('captions', 'reload', true);
}

export class YouTubeController implements PlayerController {
  private baseController: GenericVideoController;
  private win: Window;
  private isDisposed = false;
  private stateCallbacks = new Set<(state: PlayerState) => void>();
  private eventCallbacks = new Set<(event: PlayerEvent) => void>();
  private unbindBaseState: (() => void) | null = null;
  private unbindBaseEvent: (() => void) | null = null;
  private adPollInterval: ReturnType<typeof setInterval> | null = null;
  private lastAdState = false;
  private qualityPoll: ReturnType<typeof setInterval> | null = null;
  private qualities: string[] = [];
  private qualityActual = '';
  private qualityChoice = 'auto';
  private tracks: TrackInfo = { audio: [], cur: '', caps: [], capCur: 'off' };
  private captionsLoaded = false;
  private caption = '';
  private cues: Array<[number, number, string]> = [];
  private capVersion = -2;
  private captureReady = false;
  private captionPoll: ReturnType<typeof setInterval> | null = null;

  constructor(win: Window) {
    this.win = win;

    const ytVideo =
      (win.document.querySelector('#movie_player video.html5-main-video') as HTMLVideoElement) ||
      (win.document.querySelector('video.html5-main-video') as HTMLVideoElement) ||
      findBestVideoElement(win.document);

    this.baseController = new GenericVideoController(win, ytVideo);

    this.unbindBaseState = this.baseController.onState((state) => {
      this.emitState({
        ...state,
        adPlaying: this.isAdPlaying(),
        url: this.win.location?.href || state.url,
        qualities: this.qualities,
        quality: this.qualityChoice,
        qualityActual: this.qualityActual,
        audioTracks: this.tracks.audio,
        audioTrack: this.tracks.cur,
        captionTracks: this.tracks.caps,
        captionTrack: this.tracks.capCur,
        caption: this.caption,
      });
    });

    this.unbindBaseEvent = this.baseController.onEvent((event) => {
      if (this.isAdPlaying() && event.type === 'seek') {
        // Suppress seek during ad
        return;
      }
      this.emitEvent({
        ...event,
        adPlaying: this.isAdPlaying(),
      });
    });

    this.setupSpaNavigation();
    this.setupAdDetection();
    this.qualityPoll = setInterval(() => void this.refreshQuality(), 1500);
    this.captionPoll = setInterval(() => this.readCaption(), 250);
    void this.syncCues();
  }

  /** The player API lives in the page's main world; Electron exposes a bridge for it. */
  private async callPlayer(method: string, args: string[] = [], read = true): Promise<unknown> {
    const w = this.win as unknown as { __watchlink_main?: (code: string) => Promise<unknown> };
    const argList = args.map((a) => JSON.stringify(a)).join(',');
    if (typeof w.__watchlink_main === 'function')
      return w.__watchlink_main(
        `(()=>{const p=document.getElementById('movie_player');return p&&typeof p.${method}==='function'?p.${method}(${argList}):null})()`,
      );
    const p = this.win.document?.getElementById('movie_player') as unknown as Record<
      string,
      ((...a: string[]) => unknown) | undefined
    > | null;
    return read || p ? p?.[method]?.(...args) : null;
  }

  /** Runs a self-contained helper against #movie_player in the page's main world. */
  private async runInPage<T>(
    fn: (p: any, ...a: any[]) => T,
    ...args: unknown[]
  ): Promise<T | null> {
    const w = this.win as unknown as { __watchlink_main?: (code: string) => Promise<T> };
    if (typeof w.__watchlink_main === 'function') {
      const call = args.map((a) => `,${JSON.stringify(a)}`).join('');
      return w.__watchlink_main(
        `(${fn.toString()})(document.getElementById('movie_player')${call})`,
      );
    }
    return fn(this.win.document?.getElementById('movie_player'), ...args);
  }

  /** Finds the cue for the current playback time (cues come from the player's own download). */
  private readCaption(): void {
    let text = '';
    if (!this.isDisposed && this.tracks.capCur !== 'off' && this.cues.length) {
      const t = this.win.document?.querySelector('video')?.currentTime ?? 0;
      let lo = 0;
      let hi = this.cues.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((this.cues[mid] as [number, number, string])[0] <= t) lo = mid;
        else hi = mid - 1;
      }
      // Auto captions overlap; show the latest cue that has started and not yet ended.
      for (let i = lo; i >= Math.max(0, lo - 3); i--) {
        const c = this.cues[i] as [number, number, string];
        if (c[0] <= t && t < c[1]) {
          text = c[2];
          break;
        }
      }
    }
    text = text.slice(0, 300);
    if (text !== this.caption) {
      this.caption = text;
      this.emitState({ ...this.getState(), origin: 'program' });
    }
  }

  private async runMain<T>(fn: (...a: any[]) => T, ...args: unknown[]): Promise<T | null> {
    const w = this.win as unknown as { __watchlink_main?: (code: string) => Promise<T> };
    if (typeof w.__watchlink_main === 'function') {
      const call = args.map((a) => JSON.stringify(a)).join(',');
      return w.__watchlink_main(`(${fn.toString()})(${call})`);
    }
    return fn(...args);
  }

  /** Pull freshly captured subtitle cues from the page when the capture version changes. */
  private async syncCues(): Promise<void> {
    try {
      if (!this.captureReady) {
        this.captureReady = true;
        await this.runMain(pageInstallCapture);
      }
      const version = await this.runMain(pageCapVersion);
      if (version == null || version === this.capVersion) return;
      this.capVersion = version;
      const lang = this.tracks.capCur === 'off' ? '' : this.tracks.capCur;
      const cues = await this.runMain(pageGetCues, lang);
      this.cues = (cues ?? []).slice().sort((x, y) => x[0] - y[0]);
    } catch {
      /* subtitles are best effort */
    }
  }

  public setAudioTrack(id: string): void {
    void this.runInPage(pageSetAudio, id);
    setTimeout(() => void this.refreshQuality(), 900);
  }

  public setCaptionTrack(id: string): void {
    this.captionsLoaded = true;
    this.tracks = { ...this.tracks, capCur: id };
    if (id === 'off') this.cues = [];
    void this.runInPage(pageSetCaptions, id);
    for (const ms of [900, 2500, 5000]) setTimeout(() => void this.syncCues(), ms);
    setTimeout(() => void this.refreshQuality(), 900);
  }

  /** Blocks the page's own play() calls (YouTube autoplay retries) while the room is paused. */
  private setPlayGuard(block: boolean): void {
    const w = this.win as unknown as {
      __watchlink_main?: (code: string) => Promise<unknown>;
      __wlGuard?: { block: boolean };
    };
    if (typeof w.__watchlink_main === 'function') {
      void w.__watchlink_main(
        `(${installPlayGuard.toString()})(window);window.__wlGuard.block=${block}`,
      );
      return;
    }
    installPlayGuard(this.win);
    if (w.__wlGuard) w.__wlGuard.block = block;
  }

  /** Mobile YouTube autoplays muted and WatchLink has no mute control, so always unmute. */
  private async ensureAudible(): Promise<void> {
    const video = this.win.document?.querySelector('video') as HTMLVideoElement | null;
    if (video?.muted) video.muted = false;
    try {
      if ((await this.callPlayer('isMuted')) === true) await this.callPlayer('unMute');
    } catch {
      /* best effort */
    }
  }

  private async refreshQuality(): Promise<void> {
    if (this.isDisposed) return;
    void this.ensureAudible();
    if (this.isAdPlaying()) return;
    try {
      const levels = (await this.callPlayer('getAvailableQualityLevels')) as string[] | null;
      const actual = (await this.callPlayer('getPlaybackQuality')) as string | null;
      const list = Array.isArray(levels)
        ? levels.filter((q) => /^[a-z0-9]{2,12}$/.test(q) && q !== 'auto' && q !== 'tiny')
        : [];
      const info = await this.runInPage(pageReadTracks, !this.captionsLoaded);
      this.captionsLoaded = true;
      void this.syncCues();
      let tracksChanged = false;
      if (info) {
        tracksChanged =
          JSON.stringify({ ...info, capCur: 0 }) !== JSON.stringify({ ...this.tracks, capCur: 0 });
        // The player reports a default caption track even when captions are off: keep our own choice.
        this.tracks = { ...info, capCur: this.tracks.capCur };
      }
      const changed =
        tracksChanged ||
        list.join() !== this.qualities.join() ||
        (actual ?? '') !== this.qualityActual;
      this.qualities = list;
      this.qualityActual = actual ?? '';
      if (changed) this.emitState({ ...this.getState(), origin: 'program' });
    } catch {
      /* quality is best effort */
    }
  }

  public setQuality(quality: string): void {
    this.qualityChoice = quality;
    if (quality === 'auto') {
      void this.callPlayer('setPlaybackQualityRange', ['tiny', 'highres']);
      void this.callPlayer('setPlaybackQuality', ['auto']);
    } else {
      void this.callPlayer('setPlaybackQualityRange', [quality, quality]);
      void this.callPlayer('setPlaybackQuality', [quality]);
    }
    setTimeout(() => void this.refreshQuality(), 800);
  }

  private isAdPlaying(): boolean {
    if (!this.win.document) return false;
    const player = this.win.document.querySelector('#movie_player');
    if (player) {
      if (player.classList.contains('ad-showing')) return true;
      if (player.classList.contains('ad-interrupting')) return true;
    }
    const adOverlay = this.win.document.querySelector(
      '.ytp-ad-player-overlay, .ytp-ad-text, .video-ads .ytp-ad-module',
    );
    return Boolean(adOverlay && (adOverlay as HTMLElement).offsetParent !== null);
  }

  private setupAdDetection() {
    this.adPollInterval = setInterval(() => {
      if (this.isDisposed) return;
      // Decline optional cookies when YouTube's consent dialog blocks playback.
      const consent = this.win.document.querySelector(
        'ytd-consent-bump-v2-lightbox, ytd-consent-bump-lightbox, tp-yt-paper-dialog',
      );
      if (consent) {
        const reject = Array.from(consent.querySelectorAll('button')).find((button) =>
          /^(reject all|отклонить вс[её])$/i.test((button.textContent ?? '').trim()),
        );
        reject?.click();
      }
      const currentAdState = this.isAdPlaying();
      if (currentAdState !== this.lastAdState) {
        this.lastAdState = currentAdState;
        this.emitEvent({
          type: 'ad',
          position: this.baseController.getState().position,
          adPlaying: currentAdState,
          origin: 'program',
        });
        this.emitState({
          ...this.getState(),
          adPlaying: currentAdState,
          origin: 'program',
        });
      }
    }, 500);
  }

  private onNavigateFinish = () => {
    if (this.isDisposed) return;
    setTimeout(() => {
      const ytVideo =
        (this.win.document.querySelector(
          '#movie_player video.html5-main-video',
        ) as HTMLVideoElement) ||
        (this.win.document.querySelector('video.html5-main-video') as HTMLVideoElement) ||
        findBestVideoElement(this.win.document);

      if (ytVideo) {
        this.baseController.bindVideo(ytVideo);
      }
      this.emitState({
        ...this.getState(),
        url: this.win.location?.href || '',
        origin: 'program',
      });
    }, 200);
  };

  private setupSpaNavigation() {
    this.win.addEventListener('yt-navigate-finish', this.onNavigateFinish);
    if (this.win.document) {
      this.win.document.addEventListener('yt-navigate-finish', this.onNavigateFinish);
    }
  }

  public async play(): Promise<void> {
    this.setPlayGuard(false);
    void this.ensureAudible();
    return this.baseController.play();
  }

  public pause(): void {
    this.setPlayGuard(true);
    this.baseController.pause();
  }

  public seek(seconds: number): void {
    if (this.isAdPlaying()) return;
    this.baseController.seek(seconds);
  }

  public setRate(rate: number): void {
    if (this.isAdPlaying()) return;
    this.baseController.setRate(rate);
  }

  public getState(): PlayerState {
    const baseState = this.baseController.getState();
    return {
      ...baseState,
      adPlaying: this.isAdPlaying(),
      url: this.win.location?.href || baseState.url,
      qualities: this.qualities,
      quality: this.qualityChoice,
      qualityActual: this.qualityActual,
      audioTracks: this.tracks.audio,
      audioTrack: this.tracks.cur,
      captionTracks: this.tracks.caps,
      captionTrack: this.tracks.capCur,
      caption: this.caption,
    };
  }

  public onState(callback: (state: PlayerState) => void): () => void {
    this.stateCallbacks.add(callback);
    callback(this.getState());
    return () => this.stateCallbacks.delete(callback);
  }

  public onEvent(callback: (event: PlayerEvent) => void): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  private emitState(state: PlayerState) {
    for (const cb of this.stateCallbacks) {
      try {
        cb(state);
      } catch (err) {
        console.error('[WatchLink:YouTubeController] onState error:', err);
      }
    }
  }

  private emitEvent(event: PlayerEvent) {
    for (const cb of this.eventCallbacks) {
      try {
        cb(event);
      } catch (err) {
        console.error('[WatchLink:YouTubeController] onEvent error:', err);
      }
    }
  }

  public dispose(): void {
    this.isDisposed = true;
    if (this.qualityPoll) clearInterval(this.qualityPoll);
    if (this.captionPoll) clearInterval(this.captionPoll);
    if (this.adPollInterval) {
      clearInterval(this.adPollInterval);
      this.adPollInterval = null;
    }
    this.win.removeEventListener('yt-navigate-finish', this.onNavigateFinish);
    if (this.win.document) {
      this.win.document.removeEventListener('yt-navigate-finish', this.onNavigateFinish);
    }
    if (this.unbindBaseState) this.unbindBaseState();
    if (this.unbindBaseEvent) this.unbindBaseEvent();
    this.baseController.dispose();
    this.stateCallbacks.clear();
    this.eventCallbacks.clear();
  }
}

export class YouTubeAdapter implements PlayerAdapter {
  public readonly id = 'youtube';

  public matches(url: string): boolean {
    return isYouTubeUrl(url);
  }

  public attach(win: Window): PlayerController | null {
    return new YouTubeController(win);
  }
}
