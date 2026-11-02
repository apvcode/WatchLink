import type { PlayerAdapter, PlayerController, PlayerEvent, PlayerState } from './types.js';

export function findBestVideoElement(document: Document): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) return null;
  if (videos.length === 1 && videos[0]) return videos[0];

  let bestVideo: HTMLVideoElement | null = null;
  let bestScore = -1;

  for (const video of videos) {
    let score = 0;
    const rect = video.getBoundingClientRect
      ? video.getBoundingClientRect()
      : { width: video.offsetWidth || 0, height: video.offsetHeight || 0 };
    const area = (rect.width || 0) * (rect.height || 0);

    score += area;

    if (video.duration && !Number.isNaN(video.duration) && video.duration > 0) {
      score += 100000;
    }
    if (!video.paused) {
      score += 50000;
    }
    if (video.readyState >= 1) {
      score += 10000;
    }

    if (score > bestScore) {
      bestScore = score;
      bestVideo = video;
    }
  }

  return bestVideo || (videos.length > 0 && videos[0] ? videos[0] : null);
}

/**
 * Calls a method of an embedded YouTube-style player (#movie_player) in the page's own JS world.
 * Google Drive plays videos through such an embed (youtube.googleapis.com/embed).
 */
function callMoviePlayer(win: Window, method: string): Promise<unknown> {
  const w = win as unknown as { __watchlink_main?: (code: string) => Promise<unknown> };
  if (typeof w.__watchlink_main === 'function')
    return w.__watchlink_main(
      `(()=>{const p=document.getElementById('movie_player');return p&&typeof p.${method}==='function'?p.${method}():null})()`,
    );
  const p = win.document?.getElementById('movie_player') as unknown as Record<
    string,
    (() => unknown) | undefined
  > | null;
  return Promise.resolve(p?.[method]?.());
}

/** How long a cued player may take to produce its first frame before we give up waiting. */
const WAKE_TIMEOUT_MS = 8000;

export class GenericVideoController implements PlayerController {
  private video: HTMLVideoElement | null = null;
  private win: Window;
  private stateCallbacks = new Set<(state: PlayerState) => void>();
  private eventCallbacks = new Set<(event: PlayerEvent) => void>();
  private programmaticActionCount = 0;
  private programmaticResetTimer: ReturnType<typeof setTimeout> | null = null;
  private observer: MutationObserver | null = null;
  private lastTimeUpdate = 0;
  private isBufferingState = false;
  private isDisposed = false;
  private woke = false;

  constructor(win: Window, initialVideo: HTMLVideoElement | null) {
    this.win = win;
    if (initialVideo) {
      this.bindVideo(initialVideo);
    }
    this.watchForVideo();
  }

  private watchForVideo() {
    if (!this.win.document || typeof MutationObserver === 'undefined') return;

    this.observer = new MutationObserver(() => {
      if (this.isDisposed || this.video?.isConnected) return;
      const found = findBestVideoElement(this.win.document);
      if (found) {
        this.bindVideo(found);
      }
    });

    this.observer.observe(this.win.document.body || this.win.document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  private onPlay = () => {
    const origin = this.consumeProgrammaticOrigin();
    this.isBufferingState = false;
    this.emitEvent({
      type: 'play',
      position: this.video?.currentTime || 0,
      rate: this.video?.playbackRate || 1,
      buffering: false,
      origin,
    });
    this.emitState(origin);
  };

  private onPause = () => {
    const origin = this.consumeProgrammaticOrigin();
    this.emitEvent({
      type: 'pause',
      position: this.video?.currentTime || 0,
      rate: this.video?.playbackRate || 1,
      origin,
    });
    this.emitState(origin);
  };

  private onSeeking = () => {
    const origin = this.consumeProgrammaticOrigin();
    this.emitEvent({
      type: 'seek',
      position: this.video?.currentTime || 0,
      origin,
    });
    this.emitState(origin);
  };

  private onRateChange = () => {
    const origin = this.consumeProgrammaticOrigin();
    this.emitEvent({
      type: 'rate',
      position: this.video?.currentTime || 0,
      rate: this.video?.playbackRate || 1,
      origin,
    });
    this.emitState(origin);
  };

  private onWaiting = () => {
    this.isBufferingState = true;
    this.emitEvent({
      type: 'buffering',
      position: this.video?.currentTime || 0,
      buffering: true,
      origin: 'program',
    });
    this.emitState('program');
  };

  private onPlaying = () => {
    if (this.isBufferingState) {
      this.isBufferingState = false;
      this.emitEvent({
        type: 'buffering',
        position: this.video?.currentTime || 0,
        buffering: false,
        origin: 'program',
      });
      this.emitState('program');
    }
  };

  private onTimeUpdate = () => {
    const now = Date.now();
    if (now - this.lastTimeUpdate < 250) return;
    this.lastTimeUpdate = now;
    this.emitState('program');
  };

  public bindVideo(video: HTMLVideoElement) {
    if (this.video === video) return;
    if (this.video) {
      this.unbindVideo();
    }

    this.video = video;
    video.addEventListener('play', this.onPlay);
    video.addEventListener('pause', this.onPause);
    video.addEventListener('seeking', this.onSeeking);
    video.addEventListener('ratechange', this.onRateChange);
    video.addEventListener('waiting', this.onWaiting);
    video.addEventListener('playing', this.onPlaying);
    video.addEventListener('canplay', this.onPlaying);
    video.addEventListener('timeupdate', this.onTimeUpdate);

    this.emitState('program');
    void this.prepareCuedPlayer();
  }

  /**
   * An embedded player that is only "cued" has a <video> without any source until someone presses
   * play, so no duration ever reaches the room. That is how Drive's player starts on phones.
   * Start it muted just long enough to load the source, then pause it again.
   */
  private isCued(): boolean {
    const video = this.video;
    return Boolean(
      video &&
        !video.currentSrc &&
        !video.src &&
        video.readyState === 0 &&
        this.win.document?.getElementById('movie_player'),
    );
  }

  private waitForData(video: HTMLVideoElement, timeoutMs = WAKE_TIMEOUT_MS): Promise<void> {
    if (video.readyState >= 2) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        video.removeEventListener('loadeddata', done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      video.addEventListener('loadeddata', done);
    });
  }

  /**
   * Waits until the embedded player has finished initialising and is cued (state 5): commands sent
   * earlier are silently dropped. Gives up when it is already loading by itself.
   */
  private async waitUntilCued(): Promise<boolean> {
    for (let i = 0; i < 40 && !this.isDisposed; i++) {
      const state = await callMoviePlayer(this.win, 'getPlayerState').catch(() => null);
      if (state === 5) return true;
      if (state === 1 || state === 2 || state === 3) return false;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  /** The player often ignores the first playVideo() right after it reports "cued": retry. */
  private async startCued(video: HTMLVideoElement): Promise<void> {
    for (let attempt = 0; attempt < 10 && !this.isDisposed; attempt++) {
      await callMoviePlayer(this.win, 'playVideo');
      await this.waitForData(video, 1500);
      if (video.readyState >= 2 || video.currentSrc) return;
    }
  }

  private async prepareCuedPlayer(): Promise<void> {
    const video = this.video;
    if (this.woke || !video || !this.isCued()) return;
    this.woke = true;
    if (!(await this.waitUntilCued()) || this.wakeKept) return;
    this.markProgrammatic();
    await callMoviePlayer(this.win, 'mute');
    await this.startCued(video);
    // Someone asked for real playback meanwhile (play()): leave it running.
    if (this.isDisposed || this.wakeKept) return;
    this.markProgrammatic();
    await callMoviePlayer(this.win, 'pauseVideo');
    await callMoviePlayer(this.win, 'unMute');
  }
  private wakeKept = false;

  private unbindVideo() {
    if (!this.video) return;
    this.video.removeEventListener('play', this.onPlay);
    this.video.removeEventListener('pause', this.onPause);
    this.video.removeEventListener('seeking', this.onSeeking);
    this.video.removeEventListener('ratechange', this.onRateChange);
    this.video.removeEventListener('waiting', this.onWaiting);
    this.video.removeEventListener('playing', this.onPlaying);
    this.video.removeEventListener('canplay', this.onPlaying);
    this.video.removeEventListener('timeupdate', this.onTimeUpdate);
    this.video = null;
  }

  private markProgrammatic() {
    this.programmaticActionCount++;
    if (this.programmaticResetTimer) {
      clearTimeout(this.programmaticResetTimer);
    }
    this.programmaticResetTimer = setTimeout(() => {
      this.programmaticActionCount = 0;
      this.programmaticResetTimer = null;
    }, 150);
  }

  private consumeProgrammaticOrigin(): 'user' | 'program' {
    if (this.programmaticActionCount > 0) {
      this.programmaticActionCount--;
      return 'program';
    }
    return 'user';
  }

  public async play(): Promise<void> {
    if (!this.video) return;
    if (this.isCued() || (this.woke && !this.video.currentSrc && !this.video.readyState)) {
      // Not loaded yet: let the embedded player start itself, it then plays for real.
      this.wakeKept = true;
      await this.waitUntilCued();
      this.markProgrammatic();
      await callMoviePlayer(this.win, 'unMute');
      await callMoviePlayer(this.win, 'playVideo');
      await this.startCued(this.video);
      return;
    }
    this.markProgrammatic();
    if (this.video.muted) this.video.muted = false;
    try {
      await this.video.play();
    } catch (err) {
      console.warn('[WatchLink:GenericAdapter] play() failed:', err);
    }
  }

  public pause(): void {
    if (!this.video) return;
    this.markProgrammatic();
    this.video.pause();
  }

  public seek(seconds: number): void {
    if (!this.video) return;
    this.markProgrammatic();
    const clamped = Math.max(
      0,
      Number.isFinite(this.video.duration) && this.video.duration > 0
        ? Math.min(seconds, this.video.duration)
        : seconds,
    );
    this.video.currentTime = clamped;
  }

  public setRate(rate: number): void {
    if (!this.video) return;
    this.markProgrammatic();
    this.video.playbackRate = Math.max(0.25, Math.min(rate, 4.0));
  }

  public getState(): PlayerState {
    const video = this.video;
    return {
      playing: video ? !video.paused : false,
      position: video ? video.currentTime : 0,
      rate: video ? video.playbackRate : 1.0,
      duration: video && Number.isFinite(video.duration) ? video.duration : 0,
      buffering: this.isBufferingState && Boolean(video && video.readyState < 3 && !video.ended),
      adPlaying: false,
      ended: video ? video.ended : false,
      url: this.win.location ? this.win.location.href : '',
      origin: 'program',
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

  private emitState(origin: 'user' | 'program') {
    const state = { ...this.getState(), origin };
    for (const cb of this.stateCallbacks) {
      try {
        cb(state);
      } catch (err) {
        console.error('[WatchLink:GenericAdapter] onState error:', err);
      }
    }
  }

  private emitEvent(event: PlayerEvent) {
    for (const cb of this.eventCallbacks) {
      try {
        cb(event);
      } catch (err) {
        console.error('[WatchLink:GenericAdapter] onEvent error:', err);
      }
    }
  }

  public dispose(): void {
    this.isDisposed = true;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.programmaticResetTimer) {
      clearTimeout(this.programmaticResetTimer);
      this.programmaticResetTimer = null;
    }
    this.unbindVideo();
    this.stateCallbacks.clear();
    this.eventCallbacks.clear();
  }
}

export class GenericAdapter implements PlayerAdapter {
  public readonly id = 'generic';

  public matches(_url: string): boolean {
    return true;
  }

  public attach(win: Window): PlayerController | null {
    const video = findBestVideoElement(win.document);
    return new GenericVideoController(win, video);
  }
}
