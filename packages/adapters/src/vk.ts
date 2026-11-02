import { findBestVideoElement, GenericVideoController } from './generic.js';
import type { PlayerAdapter, PlayerController, PlayerEvent, PlayerState } from './types.js';

export function isVKUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'vk.com' ||
      host === 'm.vk.com' ||
      host === 'vkvideo.ru' ||
      host.endsWith('.vk.com') ||
      host.endsWith('.vkvideo.ru')
    );
  } catch {
    return false;
  }
}

export class VKVideoController implements PlayerController {
  private baseController: GenericVideoController;
  private win: Window;
  private isDisposed = false;
  private stateCallbacks = new Set<(state: PlayerState) => void>();
  private eventCallbacks = new Set<(event: PlayerEvent) => void>();
  private unbindBaseState: (() => void) | null = null;
  private unbindBaseEvent: (() => void) | null = null;

  constructor(win: Window) {
    this.win = win;

    const vkVideo =
      (win.document.querySelector(
        '.video_box video, video.videoplayer_media, #video_player video',
      ) as HTMLVideoElement) || findBestVideoElement(win.document);

    this.baseController = new GenericVideoController(win, vkVideo);

    this.unbindBaseState = this.baseController.onState((state) => {
      this.emitState({
        ...state,
        url: this.win.location?.href || state.url,
      });
    });

    this.unbindBaseEvent = this.baseController.onEvent((event) => {
      this.emitEvent(event);
    });
  }

  public async play(): Promise<void> {
    // If VK player has a click-to-play overlay, try triggering it if video doesn't start
    return this.baseController.play();
  }

  public pause(): void {
    this.baseController.pause();
  }

  public seek(seconds: number): void {
    this.baseController.seek(seconds);
  }

  public setRate(rate: number): void {
    this.baseController.setRate(rate);
  }

  public getState(): PlayerState {
    const baseState = this.baseController.getState();
    return {
      ...baseState,
      url: this.win.location?.href || baseState.url,
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
        console.error('[WatchLink:VKVideoController] onState error:', err);
      }
    }
  }

  private emitEvent(event: PlayerEvent) {
    for (const cb of this.eventCallbacks) {
      try {
        cb(event);
      } catch (err) {
        console.error('[WatchLink:VKVideoController] onEvent error:', err);
      }
    }
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    if (this.unbindBaseState) this.unbindBaseState();
    if (this.unbindBaseEvent) this.unbindBaseEvent();
    this.baseController.dispose();
    this.stateCallbacks.clear();
    this.eventCallbacks.clear();
  }
}

export class VKVideoAdapter implements PlayerAdapter {
  public readonly id = 'vk';

  public matches(url: string): boolean {
    return isVKUrl(url);
  }

  public attach(win: Window): PlayerController | null {
    return new VKVideoController(win);
  }
}
