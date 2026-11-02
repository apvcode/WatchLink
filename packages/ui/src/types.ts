import type { FriendsSnapshot } from '@watchlink/core';
import type { Language } from './i18n.js';
import type { Stats } from './stats.js';

export interface Profile {
  /** Stable per-device identity. Sent to peers for recognition, never displayed. */
  uid: string;
  name: string;
  avatar?: string;
}

export interface TrackOption {
  id: string;
  label: string;
}

export interface PeerInfo {
  id: string;
  name: string;
  avatar?: string;
  isHost: boolean;
  isBuffering: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  text: string;
  /** data:image/jpeg URL for photo messages. */
  image?: string;
  timestamp: number;
  isSystem?: boolean;
  sys?: 'joined' | 'left';
  isSelf?: boolean;
}

export type SyncState = 'sync' | 'nudge' | 'drift' | 'buffering' | 'offline';
export type Connection = 'connecting' | 'waiting' | 'connected' | 'offline' | 'error' | 'full';
export type Sheet = 'none' | 'settings' | 'profile' | 'link' | 'invite' | 'friends' | 'leaveRoom';

export interface AppState {
  screen: 'onboarding' | 'home' | 'profile' | 'friend' | 'room';
  friends: FriendsSnapshot;
  myPub: string;
  /** pub of the friend whose profile is open */
  viewFriend: string;
  stats: Stats;
  language: Language;
  profile: Profile;

  roomId: string;
  roomUrl: string;
  myPeerId: string;
  isHost: boolean;
  hostPeerId: string;
  peers: PeerInfo[];
  connection: Connection;

  videoUrl: string;
  videoTitle: string;
  playerLoading: boolean;
  /** Upcoming videos (kept on the host's device). */
  queue: Array<{ id: string; url: string }>;
  /** Edge colours of the picture [top, right, bottom, left] for the ambient glow. */
  ambient: Array<[number, number, number]> | null;
  /** User setting: draw the video-coloured glow around the picture. */
  ambientOn: boolean;
  playing: boolean;
  position: number;
  duration: number;
  rate: number;
  buffering: boolean;
  adPlaying: boolean;
  qualities: string[];
  quality: string;
  qualityActual: string;
  audioTracks: TrackOption[];
  audioTrack: string;
  captionTracks: TrackOption[];
  captionTrack: string;
  caption: string;

  syncState: SyncState;
  lamportTime: number;
  medianRttMs: number;

  chatMessages: ChatMessage[];
  unread: number;

  activeTab: 'chat' | 'people';
  isPanelOpen: boolean;
  sheet: Sheet;
  isFullscreen: boolean;
  isConsentOpen: boolean;
  consentUrl: string;
  isDebugOverlay: boolean;
  noVideoFound: boolean;
  bufferingPeerName: string | null;
  errorMessage: string | null;
}
