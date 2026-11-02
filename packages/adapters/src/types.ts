export interface PlayerState {
  playing: boolean;
  position: number;
  rate: number;
  duration: number;
  buffering: boolean;
  adPlaying: boolean;
  /** The media reached its end. */
  ended?: boolean;
  url: string;
  origin: 'user' | 'program';
  /** Available quality levels (YouTube ids such as hd1080), best first. */
  qualities?: string[];
  /** Selected quality: 'auto' or one of `qualities`. */
  quality?: string;
  /** Quality actually being played right now. */
  qualityActual?: string;
  /** Page/video title, when the page exposes one. */
  title?: string;
  /** Selectable audio tracks (per-device choice). */
  audioTracks?: Array<{ id: string; label: string }>;
  audioTrack?: string;
  /** Subtitle tracks; `captionTrack` is 'off' or a track id. */
  captionTracks?: Array<{ id: string; label: string }>;
  captionTrack?: string;
  /** Subtitle line currently on screen (rendered by WatchLink's own UI). */
  caption?: string;
}

export type PlayerEventType = 'play' | 'pause' | 'seek' | 'rate' | 'buffering' | 'state' | 'ad';

export interface PlayerEvent {
  type: PlayerEventType;
  position: number;
  rate?: number;
  buffering?: boolean;
  adPlaying?: boolean;
  origin: 'user' | 'program';
}

export interface PlayerController {
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  setQuality?(quality: string): void;
  setAudioTrack?(id: string): void;
  setCaptionTrack?(id: string): void;
  getState(): PlayerState;
  onState(callback: (state: PlayerState) => void): () => void;
  onEvent(callback: (event: PlayerEvent) => void): () => void;
  dispose(): void;
}

export interface PlayerAdapter {
  id: string;
  matches(url: string): boolean;
  attach(window: Window): PlayerController | null;
}

// Inter-process / bridge messages between WatchLink Host and injected Frame adapter
export type HostToBridgeMessage =
  | { type: 'watchlink:cmd:play' }
  | { type: 'watchlink:cmd:pause' }
  | { type: 'watchlink:cmd:seek'; position: number }
  | { type: 'watchlink:cmd:rate'; rate: number }
  | { type: 'watchlink:cmd:quality'; quality: string }
  | { type: 'watchlink:cmd:audio'; id: string }
  | { type: 'watchlink:cmd:captions'; id: string }
  | { type: 'watchlink:cmd:ambient'; on: boolean }
  | { type: 'watchlink:cmd:getState' }
  | { type: 'watchlink:ping' };

export type BridgeToHostMessage =
  | { type: 'watchlink:ready'; adapterId: string; url: string }
  | { type: 'watchlink:state'; state: PlayerState }
  | { type: 'watchlink:event'; event: PlayerEvent }
  | { type: 'watchlink:no-video'; url: string }
  | { type: 'watchlink:ambient'; colors: Array<[number, number, number]> | null }
  | { type: 'watchlink:pong' };
