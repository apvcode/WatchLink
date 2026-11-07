import { joinRoom as joinMqttRoom, getRelaySockets as mqttSockets } from '@trystero-p2p/mqtt';
import {
  joinRoom as joinNostrRoom,
  getRelaySockets as nostrSockets,
  selfId,
} from '@trystero-p2p/nostr';
import { rtcOptions } from './channel.js';
import {
  APP_NAME,
  IMG_CHUNK_CHARS,
  IMG_CHUNK_INTERVAL_MS,
  IMG_MAX_CHUNKS,
  JOIN_TIMEOUT_MS,
  NOSTR_RELAYS,
  REJOIN_EVERY_MS,
  SIGNALING_FALLBACK_TIMEOUT_MS,
} from './constants.js';
import { SyncEngine } from './sync-engine.js';
import type { ChatMsg, ChatReply, ImgMsg, ProtocolMsg, SignalingStrategy } from './types.js';
import { MessageValidator } from './validator.js';

export interface RoomOptions {
  appId?: string;
  relayUrls?: string[];
  testOnlyLoopback?: boolean;
  strategy?: SignalingStrategy;
  roomId?: string;
  secret?: string;
  userName: string;
  userUid?: string;
  userAvatar?: string;
  isHost?: boolean;
  hostOnlyControls?: boolean;
}

export interface ChatMessage {
  id: string;
  peerId: string;
  senderName: string;
  text: string;
  /** data:image/jpeg URL when this message is a photo. */
  image?: string;
  /** The message this one answers. */
  reply?: ChatReply;
  ts: number;
  isSelf: boolean;
}

export class WatchLinkRoom {
  public readonly selfId: string;
  public userName: string;
  public readonly userUid?: string;
  public userAvatar?: string;
  public readonly roomId: string;
  public readonly secret: string;
  public strategy: SignalingStrategy;
  public readonly syncEngine: SyncEngine;
  public readonly validator: MessageValidator;

  private transports = new Map<
    SignalingStrategy,
    {
      room: ReturnType<typeof joinNostrRoom>;
      send: (msg: ProtocolMsg, peer?: string) => Promise<unknown>;
    }
  >();
  private peerRoutes = new Map<string, Set<SignalingStrategy>>();
  private monitor: ReturnType<typeof setInterval> | null = null;
  private statusListeners = new Set<(status: string) => void>();
  private status = 'offline';
  private appId: string;
  private isGuest: boolean;
  private relayUrls?: string[];
  private testOnlyLoopback?: boolean;

  public onStatus(listener: (status: string) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }
  private setStatus(status: string): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
  private pendingImages = new Map<
    string,
    { parts: string[]; got: number; n: number; started: number }
  >();
  private chatListeners: Array<(msg: ChatMessage) => void> = [];
  private peerChangeListeners: Array<(peers: Array<{ peerId: string; name: string }>) => void> = [];
  private isDestroyed = false;

  constructor(options: RoomOptions) {
    this.selfId = selfId;
    this.relayUrls = options.relayUrls;
    this.testOnlyLoopback = options.testOnlyLoopback;
    this.isGuest = !options.isHost;
    this.appId = options.appId ?? APP_NAME.toLowerCase();
    this.userName = options.userName;
    this.userUid = options.userUid;
    this.userAvatar = options.userAvatar;
    this.roomId = options.roomId ?? WatchLinkRoom.generateRoomId();
    this.secret = options.secret ?? WatchLinkRoom.generateSecret();
    this.strategy = options.strategy ?? 'nostr';

    this.validator = new MessageValidator();
    this.syncEngine = new SyncEngine({
      selfId: this.selfId,
      selfName: this.userName,
      bufferingDelayMs: 4000, // only long stalls pause the room; short ones are absorbed by drift tolerance
      awaitingState: !options.isHost,
      roomCreatorId: options.isHost ? this.selfId : undefined,
      hostOnlyControls: options.hostOnlyControls ?? false,
    });
  }

  public static generateRoomId(): string {
    const bytes = new Uint8Array(16); // 128-bit
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  public static generateSecret(): string {
    return WatchLinkRoom.generateRoomId();
  }

  public static parseInviteCode(inviteCode: string): {
    roomId: string;
    secret: string;
    strategy: SignalingStrategy;
  } | null {
    try {
      let code = inviteCode.trim();
      if (code.startsWith('wl://join#')) {
        code = code.substring('wl://join#'.length);
      }
      const params = new URLSearchParams(code);
      const roomId = params.get('roomId');
      const secret = params.get('secret');
      const strategy = (params.get('strategy') ?? 'nostr') as SignalingStrategy;

      if (
        !roomId ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(roomId) ||
        !secret ||
        !/^[a-zA-Z0-9_-]{8,128}$/.test(secret) ||
        !['nostr', 'mqtt'].includes(strategy)
      )
        return null;
      return { roomId, secret, strategy };
    } catch {
      return null;
    }
  }

  public getInviteCode(): string {
    return `wl://join#roomId=${this.roomId}&secret=${this.secret}&strategy=${this.strategy}`;
  }

  public async connect(): Promise<void> {
    if (this.isDestroyed) return;

    // Set outbound handler for sync engine
    this.syncEngine.setPeerAliveCheck((id) => this.peerRoutes.has(id));
    this.syncEngine.setOutboundHandler((msg: ProtocolMsg, targetPeerId?: string) => {
      this.sendProtocolMsg(msg, targetPeerId);
    });

    this.syncEngine.start();

    this.setStatus('connecting');
    this.addTransport(this.strategy);
    if (!this.relayUrls) this.addTransport('mqtt'); // signal on both networks right away
    const started = Date.now();
    this.monitor = setInterval(() => {
      if (this.isDestroyed) return;
      const elapsed = Date.now() - started;
      // Both strategies remain advertised once fallback is enabled, avoiding split rooms.
      if (elapsed >= SIGNALING_FALLBACK_TIMEOUT_MS) this.addTransport('mqtt');
      const connected = [...this.transports.keys()].some((strategy) =>
        Object.values(strategy === 'nostr' ? nostrSockets() : mqttSockets()).some(
          (socket: any) => socket.readyState === 1,
        ),
      );
      // A lost offer/answer is never re-sent, so a guest that is still alone re-announces itself.
      if (this.isGuest && !this.peerRoutes.size && !this.everConnected) {
        const slot = Math.floor(elapsed / REJOIN_EVERY_MS);
        if (slot > this.rejoinSlot && elapsed < JOIN_TIMEOUT_MS - 2000) {
          this.rejoinSlot = slot;
          this.rejoinTransports();
        }
      }
      if (this.peerRoutes.size) this.everConnected = true;
      try {
        const count = (o: Record<string, any>) => {
          const v = Object.values(o);
          return `${v.filter((s: any) => s.readyState === 1).length}/${v.length}`;
        };
        (globalThis as any).__wlDiag = {
          nostr: count(nostrSockets()),
          mqtt: count(mqttSockets()),
          transports: [...this.transports.keys()],
          routes: this.peerRoutes.size,
          elapsed,
        };
      } catch {}
      this.setStatus(
        this.full
          ? 'full'
          : this.peerRoutes.size
            ? 'connected'
            : this.isGuest && !this.everConnected && elapsed > JOIN_TIMEOUT_MS
              ? 'error' // signaling is up but the host never answered: room not found / unreachable
              : connected
                ? 'waiting'
                : elapsed > 16000
                  ? 'error'
                  : 'connecting',
      );
    }, 500);
  }

  private full = false;
  private rejoinSlot = 0;
  private everConnected = false;

  private rejoinTransports(): void {
    for (const [strategy, t] of [...this.transports]) {
      try {
        t.room.leave();
      } catch {}
      this.transports.delete(strategy);
      this.addTransport(strategy);
    }
  }

  private addTransport(strategy: SignalingStrategy): void {
    if (this.transports.has(strategy) || this.isDestroyed) return;
    try {
      const room = (strategy === 'nostr' ? joinNostrRoom : joinMqttRoom)(
        {
          appId: this.appId,
          relayConfig: strategy === 'nostr' ? { urls: this.relayUrls ?? NOSTR_RELAYS } : undefined,
          ...rtcOptions(this.testOnlyLoopback),
          _test_only_mdnsHostFallbackToLoopback: this.testOnlyLoopback,
          password: this.secret,
        },
        this.roomId,
      );
      const action = room.makeAction<string>('wl-v2');
      const send = (msg: ProtocolMsg, peer?: string) =>
        action.send(JSON.stringify(msg), { target: peer });
      action.onReceive = ({ byteLength }) => byteLength <= 8192;
      this.transports.set(strategy, { room, send });
      action.onMessage = (data, { peerId }) => {
        // A single deterministic route per peer prevents duplicate commands and chats.
        const routes = this.peerRoutes.get(peerId);
        if (routes && (routes.has('nostr') ? strategy === 'nostr' : strategy === 'mqtt'))
          this.handleIncomingData(data, peerId);
      };
      room.onPeerJoin = (peerId) => {
        let routes = this.peerRoutes.get(peerId);
        if (!routes) {
          routes = new Set();
          this.peerRoutes.set(peerId, routes);
        }
        routes.add(strategy);
        void send(
          {
            v: 2,
            type: 'hello',
            peerId: this.selfId,
            name: this.userName,
            uid: this.userUid,
            avatar: this.userAvatar,
          },
          peerId,
        );
        if (!this.full) this.setStatus('connected');
      };
      room.onPeerLeave = (peerId) => {
        const routes = this.peerRoutes.get(peerId);
        routes?.delete(strategy);
        if (routes?.size) return;
        this.peerRoutes.delete(peerId);
        this.syncEngine.handlePeerLeft(peerId);
        this.validator.removePeer(peerId);
        this.notifyPeerChange();
      };
    } catch {
      if (strategy === 'mqtt') this.setStatus('error');
    }
  }

  private sendProtocolMsg(msg: ProtocolMsg, targetPeerId?: string): void {
    const ids = targetPeerId ? [targetPeerId] : [...this.peerRoutes.keys()];
    for (const peerId of ids) {
      const routes = this.peerRoutes.get(peerId);
      const strategy = routes?.has('nostr') ? 'nostr' : 'mqtt';
      void this.transports
        .get(strategy)
        ?.send(msg, peerId)
        .catch(() => this.setStatus('error'));
    }
  }

  private handleIncomingData(data: unknown, peerId: string): void {
    const result = this.validator.parseAndValidate(data, peerId);
    if (!result.valid) {
      console.warn(`[WatchLink] Dropped invalid message from ${peerId}: ${result.reason}`);
      return;
    }

    const msg = result.msg;
    if (msg.type === 'error') {
      // Only a peer we handshook with may report errors; ROOM_FULL arrives before any hello.
      if (msg.code === 'ROOM_FULL') {
        this.full = true;
        this.setStatus('full');
      } else if (this.syncEngine.getPeers().some((p) => p.peerId === peerId)) {
        this.setStatus('error');
      }
      return;
    }
    if (msg.type !== 'hello' && !this.syncEngine.getPeers().some((p) => p.peerId === peerId))
      return;
    if (msg.type === 'chat') {
      // Find sender name
      const peer = this.syncEngine.getPeers().find((p) => p.peerId === peerId);
      const senderName = peer?.name ?? 'Peer';
      this.emitChatMessage({
        id: msg.id,
        peerId,
        senderName,
        text: msg.text,
        reply: msg.re,
        ts: msg.ts,
        isSelf: false,
      });
      return;
    }

    if (msg.type === 'img') {
      this.handleImageChunk(msg, peerId);
      return;
    }

    this.syncEngine.handleRemoteMessage(msg, peerId);
    if (msg.type === 'hello') {
      this.notifyPeerChange();
    }
  }

  /** Change own name/avatar and tell every connected peer immediately. */
  public updateProfile(name: string, avatar?: string): void {
    this.userName = name;
    this.userAvatar = avatar;
    this.sendProtocolMsg({
      v: 2,
      type: 'hello',
      peerId: this.selfId,
      name,
      uid: this.userUid,
      avatar,
    });
  }

  public sendChat(text: string, reply?: ChatReply): ChatMessage | null {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 1000) return null;

    const chatMsg: ChatMsg = {
      v: 2,
      type: 'chat',
      id: Math.random().toString(36).substring(2, 10),
      text: trimmed,
      ts: Date.now(),
      ...(reply ? { re: reply } : {}),
    };

    this.sendProtocolMsg(chatMsg);

    const localChat: ChatMessage = {
      id: chatMsg.id,
      peerId: this.selfId,
      senderName: this.userName,
      text: trimmed,
      reply,
      ts: chatMsg.ts,
      isSelf: true,
    };

    this.emitChatMessage(localChat);
    return localChat;
  }

  /** Send a JPEG photo (base64, no data: prefix) as rate-limited chunks. */
  public async sendImage(base64: string): Promise<ChatMessage | null> {
    if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return null;
    const n = Math.ceil(base64.length / IMG_CHUNK_CHARS);
    if (n < 1 || n > IMG_MAX_CHUNKS) return null;
    const id = Math.random().toString(36).substring(2, 10);
    const ts = Date.now();
    const local: ChatMessage = {
      id,
      peerId: this.selfId,
      senderName: this.userName,
      text: '',
      image: `data:image/jpeg;base64,${base64}`,
      ts,
      isSelf: true,
    };
    this.emitChatMessage(local);
    for (let i = 0; i < n; i++) {
      this.sendProtocolMsg({
        v: 2,
        type: 'img',
        id,
        ts,
        i,
        n,
        d: base64.slice(i * IMG_CHUNK_CHARS, (i + 1) * IMG_CHUNK_CHARS),
      });
      if (i < n - 1) await new Promise((r) => setTimeout(r, IMG_CHUNK_INTERVAL_MS));
    }
    return local;
  }

  private handleImageChunk(msg: ImgMsg, peerId: string): void {
    const now = Date.now();
    for (const [k, v] of this.pendingImages) {
      if (now - v.started > 30_000) this.pendingImages.delete(k);
    }
    const key = `${peerId}:${msg.id}`;
    let entry = this.pendingImages.get(key);
    if (!entry) {
      const own = [...this.pendingImages.keys()].filter((k) => k.startsWith(`${peerId}:`)).length;
      if (own >= 2 || this.pendingImages.size >= 16) return;
      entry = { parts: new Array<string>(msg.n), got: 0, n: msg.n, started: now };
      this.pendingImages.set(key, entry);
    }
    if (entry.n !== msg.n || entry.parts[msg.i] !== undefined) return;
    entry.parts[msg.i] = msg.d;
    entry.got++;
    if (entry.got < entry.n) return;
    this.pendingImages.delete(key);
    if (!entry.parts[0]?.startsWith('/9j/')) return; // not a JPEG
    const peer = this.syncEngine.getPeers().find((p) => p.peerId === peerId);
    this.emitChatMessage({
      id: msg.id,
      peerId,
      senderName: peer?.name ?? 'Peer',
      text: '',
      image: `data:image/jpeg;base64,${entry.parts.join('')}`,
      ts: msg.ts,
      isSelf: false,
    });
  }

  public onChat(listener: (msg: ChatMessage) => void): () => void {
    this.chatListeners.push(listener);
    return () => {
      this.chatListeners = this.chatListeners.filter((l) => l !== listener);
    };
  }

  public onPeersChange(
    listener: (peers: Array<{ peerId: string; name: string }>) => void,
  ): () => void {
    this.peerChangeListeners.push(listener);
    return () => {
      this.peerChangeListeners = this.peerChangeListeners.filter((l) => l !== listener);
    };
  }

  private emitChatMessage(msg: ChatMessage): void {
    for (const listener of this.chatListeners) {
      listener(msg);
    }
  }

  private notifyPeerChange(): void {
    const peers = this.syncEngine.getPeers().map((p) => ({
      peerId: p.peerId,
      name: p.name,
    }));
    for (const listener of this.peerChangeListeners) {
      listener(peers);
    }
  }

  public disconnect(): void {
    this.isDestroyed = true;
    this.syncEngine.stop();
    if (this.monitor) clearInterval(this.monitor);
    for (const { room } of this.transports.values()) room.leave();
    this.transports.clear();
    this.peerRoutes.clear();
    this.chatListeners = [];
    this.peerChangeListeners = [];
    this.setStatus('offline');
    this.statusListeners.clear();
  }
}
