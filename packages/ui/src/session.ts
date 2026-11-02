import { type PlayerStateEvent, WatchLinkRoom } from '@watchlink/core';
import { host, isPhone, normalizeSource } from './host.js';
import { type Stats, StatsTracker } from './stats.js';
import type { AppState, Connection, Profile, TrackOption } from './types.js';

function pref(key: string): string {
  try {
    return localStorage.getItem(`watchlink:${key}`) ?? '';
  } catch {
    return '';
  }
}
function save(key: string, value: string): void {
  try {
    localStorage.setItem(`watchlink:${key}`, value);
  } catch {}
}

type Update = (fn: (state: AppState) => AppState) => void;

const KNOWN_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vk\.com|vkvideo\.ru|drive\.google\.com)$/;

export class Session {
  room: WatchLinkRoom | null = null;
  private unsubscribe: Array<() => void> = [];
  private currentUrl = '';
  private ambientOn = loadAmbientPref();
  private ambientOffSentFor = '';
  private pendingUrl = '';
  private queue: Array<{ id: string; url: string }> = [];
  private endedHandled = false;
  private localNav = '';
  private playerPosition = 0;
  private rejected = new Set<string>();
  private awaitReady = false;
  private qualityApplied = false;
  private preferredQuality = 'auto';
  private preferredAudio = pref('audio');
  private preferredCaption = pref('captions') || 'off';
  private audioApplied = false;
  private captionApplied = false;
  private knownPeers = new Map<string, string>();
  private update: Update;
  private tracker: StatsTracker;
  constructor(update: Update, onStats: (stats: Stats) => void = () => {}) {
    this.update = update;
    this.tracker = new StatsTracker(onStats);
  }

  updateProfile(name: string, avatar: string | undefined): void {
    this.room?.updateProfile(name.trim() || 'Guest', avatar);
  }

  async open(profile: Profile, url: string, invite?: string): Promise<void> {
    this.close();
    const parsed = invite ? WatchLinkRoom.parseInviteCode(invite) : undefined;
    if (invite && !parsed) throw new Error('badInvite');
    const source = url ? normalizeSource(url) : '';
    const room = new WatchLinkRoom({
      relayUrls: import.meta.env.VITE_WATCHLINK_TEST_RELAY
        ? [import.meta.env.VITE_WATCHLINK_TEST_RELAY]
        : undefined,
      testOnlyLoopback: Boolean(import.meta.env.VITE_WATCHLINK_TEST_RELAY),
      userName: profile.name.trim() || 'Guest',
      userUid: profile.uid,
      userAvatar: profile.avatar,
      isHost: !invite,
      hostOnlyControls: !invite, // only the host pauses/seeks/changes video
      ...parsed,
    });
    this.room = room;
    host.send({ type: 'service', on: true });
    this.knownPeers.clear();
    this.tracker.start(!invite);
    this.update((s) => ({
      ...s,
      screen: 'room',
      roomId: room.roomId,
      roomUrl: room.getInviteCode(),
      myPeerId: room.selfId,
      hostPeerId: invite ? '' : room.selfId,
      isHost: !invite,
      peers: [],
      chatMessages: [],
      unread: 0,
      videoUrl: '',
      videoTitle: '',
      ambient: null,
      queue: [],
      playing: false,
      position: 0,
      duration: 0,
      qualities: [],
      quality: 'auto',
      qualityActual: '',
      syncState: 'offline',
      connection: 'connecting',
      activeTab: 'chat',
      sheet: 'none',
      isFullscreen: false,
      errorMessage: null,
    }));

    this.unsubscribe.push(
      room.onChat((m) =>
        this.update((s) => {
          const avatar = s.peers.find((p) => p.id === m.peerId)?.avatar;
          const seen = s.isPanelOpen && s.activeTab === 'chat';
          return {
            ...s,
            unread: m.isSelf || seen ? 0 : s.unread + 1,
            chatMessages: [
              ...s.chatMessages.slice(-299),
              {
                id: m.id,
                senderId: m.peerId,
                senderName: m.senderName,
                senderAvatar: m.isSelf ? s.profile.avatar : avatar,
                text: m.text,
                image: m.image,
                timestamp: m.ts,
                isSelf: m.isSelf,
              },
            ],
          };
        }),
      ),
    );
    this.unsubscribe.push(
      room.onStatus((status) =>
        this.update((s) => ({
          ...s,
          connection: status as Connection,
          syncState: status === 'connected' ? 'sync' : 'offline',
          errorMessage:
            status === 'error' ? 'cantConnect' : status === 'full' ? 'roomFull' : s.errorMessage,
        })),
      ),
    );
    this.unsubscribe.push(
      host.subscribe((message) => {
        if (message.type === 'watchlink:loading')
          this.update((s) => ({ ...s, playerLoading: Boolean(message.loading) }));
        if (message.type === 'watchlink:state' && message.state) {
          // the page bridge restarts with every page load: re-apply "off"
          if (!this.ambientOn && this.ambientOffSentFor !== this.currentUrl) {
            this.ambientOffSentFor = this.currentUrl;
            host.send({ type: 'command', action: 'ambient', on: false });
          }
          const p = message.state as PlayerStateEvent & {
            qualities?: string[];
            quality?: string;
            qualityActual?: string;
            title?: string;
            audioTracks?: TrackOption[];
            audioTrack?: string;
            captionTracks?: TrackOption[];
            captionTrack?: string;
            caption?: string;
          };
          this.playerPosition = p.position;
          if (p.title && this.currentUrl) this.tracker.setVideo(this.currentUrl, p.title);
          this.handleEnded(room, p);
          if (![p.position, p.rate, p.duration].every(Number.isFinite)) return;
          room.syncEngine.handleLocalPlayerEvent({ ...p, url: this.currentUrl, origin: 'program' });
          if (p.playing && !p.adPlaying && !room.syncEngine.getRoomState().playing)
            host.send({ type: 'command', action: 'pause' });
          if (this.awaitReady && p.duration > 0 && !p.adPlaying) {
            // Late join / new video: align to the room once our player can actually seek.
            this.awaitReady = false;
            setTimeout(() => room.syncEngine.resync(), 350);
            setTimeout(() => room.syncEngine.resync(), 2200);
          }
          if (
            !this.qualityApplied &&
            this.preferredQuality !== 'auto' &&
            p.qualities?.includes(this.preferredQuality)
          ) {
            this.qualityApplied = true;
            host.send({ type: 'command', action: 'quality', quality: this.preferredQuality });
          }
          // Re-apply this device's saved audio/subtitle language once per video.
          if (!this.audioApplied && this.preferredAudio && p.audioTracks?.length) {
            this.audioApplied = true;
            const want = p.audioTracks.find((t) => t.label === this.preferredAudio);
            if (want && want.id !== p.audioTrack)
              host.send({ type: 'command', action: 'audio', id: want.id });
          }
          if (!this.captionApplied && p.captionTracks?.length) {
            this.captionApplied = true;
            if (
              this.preferredCaption !== 'off' &&
              p.captionTracks.some((t) => t.id === this.preferredCaption)
            )
              host.send({ type: 'command', action: 'captions', id: this.preferredCaption });
          }
          this.update((s) => ({
            ...s,
            audioTracks: p.audioTracks ?? [],
            audioTrack: p.audioTrack ?? '',
            captionTracks: p.captionTracks ?? [],
            captionTrack: p.captionTrack ?? 'off',
            caption: p.captionTrack && p.captionTrack !== 'off' ? (p.caption ?? '') : '',
            playing: p.playing,
            position: p.position,
            duration: p.duration,
            rate: p.rate,
            buffering: p.buffering,
            adPlaying: p.adPlaying,
            qualities: p.qualities ?? [],
            quality: this.preferredQuality,
            qualityActual: p.qualityActual ?? '',
            videoTitle: p.title || s.videoTitle,
            noVideoFound: false,
          }));
        }
        if (message.type === 'watchlink:ambient')
          this.update((s) => ({
            ...s,
            ambient: Array.isArray(message.colors) ? (message.colors as AppState['ambient']) : null,
          }));
        if (message.type === 'watchlink:no-video')
          this.update((s) => ({ ...s, noVideoFound: true }));
        if (message.type === 'watchlink:error')
          this.update((s) => ({ ...s, errorMessage: String(message.message) }));
      }),
    );
    room.syncEngine.setLocalActionHandler((action) => {
      if (action.type === 'nav' && action.url) {
        this.navigate(action.url, action.url === source || action.url === this.localNav);
        return;
      }
      if (this.pendingUrl || !this.currentUrl) return;
      if (
        action.position !== undefined &&
        action.type !== 'rate' &&
        (action.type === 'seek' || Math.abs(action.position - this.playerPosition) > 0.3)
      )
        host.send({ type: 'command', action: 'seek', position: action.position });
      if (action.rate !== undefined)
        host.send({ type: 'command', action: 'rate', rate: action.rate });
      if (action.type !== 'seek')
        host.send({ type: 'command', action: action.type, rate: action.rate });
    });
    const timer = setInterval(() => {
      const engine = room.syncEngine;
      const peers = engine.getPeers();
      const state = engine.getRoomState();
      const joined: Array<{ id: string; name: string }> = [];
      const left: Array<{ id: string; name: string }> = [];
      const current = new Map(peers.map((p) => [p.peerId, p.name]));
      for (const [id, name] of current) if (!this.knownPeers.has(id)) joined.push({ id, name });
      for (const [id, name] of this.knownPeers) if (!current.has(id)) left.push({ id, name });
      this.knownPeers = current;
      this.tracker.tick(peers.length + 1);
      this.update((s) => ({
        ...s,
        peers: peers.map((p) => ({
          id: p.peerId,
          name: p.name,
          avatar: p.avatar,
          isHost: p.peerId === engine.roomCreatorId,
          isBuffering: p.buffering,
        })),
        chatMessages:
          joined.length || left.length
            ? [
                ...s.chatMessages,
                ...joined.map((j) => sys(j.id, j.name, 'joined')),
                ...left.map((j) => sys(j.id, j.name, 'left')),
              ].slice(-300)
            : s.chatMessages,
        isHost: engine.roomCreatorId === room.selfId,
        hostPeerId: engine.roomCreatorId,
        lamportTime: engine.getLamport(),
        medianRttMs: engine.clock.getRttStats().medianRtt,
        bufferingPeerName: state.hold
          ? state.holdBy === room.selfId
            ? null
            : (peers.find((p) => p.peerId === state.holdBy)?.name ?? null)
          : null,
      }));
      host.send({ type: 'command', action: 'getState' });
    }, 500);
    this.unsubscribe.push(() => clearInterval(timer));
    await room.connect();
    if (source) {
      this.localNav = source;
      room.syncEngine.command('nav', undefined, undefined, source);
    }
  }

  /** Host only: when the video finishes, start the next queued one or rewind and pause. */
  private handleEnded(
    room: WatchLinkRoom,
    p: {
      ended?: boolean;
      playing: boolean;
      position: number;
      duration: number;
      adPlaying: boolean;
    },
  ): void {
    const ended =
      Boolean(p.ended) || (p.duration > 1 && p.position >= p.duration - 0.4 && !p.playing);
    if (!ended) {
      if (p.duration > 0 && p.position < p.duration - 2) this.endedHandled = false;
      return;
    }
    if (this.endedHandled || p.adPlaying || !p.duration) return;
    if (room.syncEngine.roomCreatorId !== room.selfId) return;
    this.endedHandled = true;
    if (this.queue.length) {
      this.playNext();
      return;
    }
    room.syncEngine.command('seek', 0);
    room.syncEngine.command('pause', 0);
  }

  private publishQueue(): void {
    const queue = [...this.queue];
    this.update((s) => ({ ...s, queue }));
  }

  addToQueue(raw: string): void {
    const url = normalizeSource(raw);
    this.queue.push({ id: Math.random().toString(36).slice(2, 9), url });
    this.publishQueue();
  }

  removeFromQueue(id: string): void {
    this.queue = this.queue.filter((q) => q.id !== id);
    this.publishQueue();
  }

  /** Plays the first queued video now (or a specific one). */
  playNext(id?: string): void {
    const index = id ? this.queue.findIndex((q) => q.id === id) : 0;
    const next = this.queue[index];
    if (!next) return;
    this.queue.splice(index, 1);
    this.publishQueue();
    this.endedHandled = true;
    this.changeVideo(next.url);
  }

  changeVideo(raw: string): void {
    const url = normalizeSource(raw);
    this.localNav = url;
    this.rejected.delete(url);
    this.room?.syncEngine.command('nav', undefined, undefined, url);
  }

  setAudio(track: TrackOption): void {
    this.preferredAudio = track.label;
    save('audio', track.label);
    host.send({ type: 'command', action: 'audio', id: track.id });
    this.update((s) => ({ ...s, audioTrack: track.id }));
  }

  setCaptions(id: string): void {
    this.preferredCaption = id;
    save('captions', id);
    host.send({ type: 'command', action: 'captions', id });
    this.update((s) => ({ ...s, captionTrack: id, caption: '' }));
  }

  setAmbient(on: boolean): void {
    this.ambientOn = on;
    this.ambientOffSentFor = on ? '' : this.currentUrl;
    try {
      localStorage.setItem('watchlink:ambient', on ? '1' : '0');
    } catch {}
    host.send({ type: 'command', action: 'ambient', on });
    this.update((s) => ({ ...s, ambientOn: on, ambient: on ? s.ambient : null }));
  }

  setQuality(quality: string): void {
    this.preferredQuality = quality;
    this.qualityApplied = true;
    host.send({ type: 'command', action: 'quality', quality });
    this.update((s) => ({ ...s, quality }));
  }

  navigate(raw: string, approved: boolean): void {
    let url: string;
    try {
      url = normalizeSource(raw);
    } catch {
      return;
    }
    if (url === this.currentUrl || this.rejected.has(url)) return;
    const hostname = new URL(url).hostname;
    if (!approved && !KNOWN_HOSTS.test(hostname)) {
      this.pendingUrl = url;
      this.update((s) => ({ ...s, isConsentOpen: true, consentUrl: url }));
      return;
    }
    this.pendingUrl = '';
    this.currentUrl = url;
    this.awaitReady = true;
    this.endedHandled = false;
    this.qualityApplied = false;
    this.audioApplied = false;
    this.captionApplied = false;
    host.send({ type: 'load', url });
    this.tracker.setVideo(url);
    this.update((s) => ({
      ...s,
      videoUrl: url,
      videoTitle: '',
      duration: 0,
      position: 0,
      playing: false,
      qualities: [],
      audioTracks: [],
      captionTracks: [],
      caption: '',
      noVideoFound: false,
      isConsentOpen: false,
      errorMessage: null,
    }));
  }
  approve(url: string): void {
    this.navigate(url, true);
  }
  reject(): void {
    this.rejected.add(this.pendingUrl);
    this.pendingUrl = '';
  }
  reload(): void {
    if (!this.currentUrl) return;
    this.awaitReady = true;
    host.send({ type: 'load', url: this.currentUrl });
  }
  close(): void {
    const hadRoom = Boolean(this.room);
    this.tracker.stop();
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.unsubscribe = [];
    this.room?.disconnect();
    this.room = null;
    this.currentUrl = '';
    this.pendingUrl = '';
    this.localNav = '';
    this.awaitReady = false;
    this.rejected.clear();
    this.queue = [];
    this.endedHandled = false;
    this.knownPeers.clear();
    if (hadRoom) {
      host.send({ type: 'clear' });
      host.send({ type: 'service', on: false });
    }
  }
}

function sys(id: string, name: string, kind: 'joined' | 'left') {
  return {
    id: `${kind}-${id}-${Date.now()}`,
    senderId: id,
    senderName: name,
    text: '',
    sys: kind,
    timestamp: Date.now(),
    isSystem: true,
  };
}

export function loadAmbientPref(): boolean {
  if (isPhone) return false;
  try {
    return localStorage.getItem('watchlink:ambient') !== '0';
  } catch {
    return true;
  }
}
