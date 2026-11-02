import { type Channel, type ChannelFactory, trysteroChannel } from './channel.js';

/** Compact statistics shared with friends (must fit one 8 KB message). */
export interface SharedStats {
  since: number;
  totalSec: number;
  longestSec: number;
  largestRoom: number;
  hosted: number;
  sessions: number;
  /** Seconds per local day (YYYY-MM-DD), last 30 days. */
  days: Record<string, number>;
  videos: Array<{ url: string; title: string; site: string; views: number }>;
  sites: Record<string, number>;
}

export interface Friend {
  pub: string;
  name: string;
  avatar?: string;
  /** Shared secret protecting the private room of this friendship. */
  secret: string;
  since: number;
  /** Last statistics we received (cache from the last time they were online). */
  stats?: SharedStats;
  lastSeen?: number;
}

export interface FriendRequest {
  pub: string;
  name: string;
  avatar?: string;
  at: number;
}

export interface OutgoingRequest {
  pub: string;
  at: number;
}

export interface FriendsData {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: OutgoingRequest[];
}

export interface Presence {
  online: boolean;
  /** 'watching' while the friend sits in a room. */
  status: 'idle' | 'watching';
  invite?: { code: string; title: string; at: number };
}

export interface FriendsSelf {
  pub: string;
  name: string;
  avatar?: string;
}

export interface FriendsStorage {
  load(): FriendsData;
  save(data: FriendsData): void;
}

export interface FriendsOptions {
  self: FriendsSelf;
  storage: FriendsStorage;
  channel?: ChannelFactory;
  relayUrls?: string[];
  testOnlyLoopback?: boolean;
  getStats?: () => SharedStats | undefined;
}

export interface FriendsSnapshot extends FriendsData {
  presence: Record<string, Presence>;
}

const PUB = /^[a-f0-9]{32}$/;
const SECRET = /^[a-f0-9]{32}$/;
const MAX_INCOMING = 50;
const REQUEST_TTL_MS = 14 * 86_400_000;
const INBOX_PASSWORD = 'watchlink-inbox-v1';
const AVATAR_MAX = 6000;

export async function derivePubId(uid: string): Promise<string> {
  const bytes = new TextEncoder().encode(`watchlink-pub:${uid}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function pairRoom(a: string, b: string): Promise<string> {
  const bytes = new TextEncoder().encode(`watchlink-pair:${[a, b].sort().join(':')}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `pair-${Array.from(digest.slice(0, 12), (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function parseFriendCode(code: string): string | null {
  const m = code.trim().match(/(?:wl:\/\/friend#)?(?:pub=)?([a-f0-9]{32})$/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

export function friendCode(pub: string): string {
  return `wl://friend#pub=${pub}`;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const avatarOf = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length <= AVATAR_MAX && /^data:image\/(jpeg|png|webp);base64,/.test(v)
    ? v
    : undefined;

/** Defensive copy of statistics received from a peer. */
export function sanitizeStats(raw: unknown): SharedStats | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const days: Record<string, number> = {};
  if (r.days && typeof r.days === 'object')
    for (const [k, v] of Object.entries(r.days).slice(0, 40))
      if (/^\d{4}-\d{2}-\d{2}$/.test(k)) days[k] = num(v);
  const sites: Record<string, number> = {};
  if (r.sites && typeof r.sites === 'object')
    for (const [k, v] of Object.entries(r.sites).slice(0, 12)) sites[k.slice(0, 40)] = num(v);
  const videos = Array.isArray(r.videos)
    ? r.videos.slice(0, 8).flatMap((v: any) => {
        const url = str(v?.url, 300);
        return /^https?:\/\//.test(url)
          ? [{ url, title: str(v?.title, 100), site: str(v?.site, 40), views: num(v?.views) }]
          : [];
      })
    : [];
  return {
    since: num(r.since),
    totalSec: num(r.totalSec),
    longestSec: num(r.longestSec),
    largestRoom: num(r.largestRoom),
    hosted: num(r.hosted),
    sessions: num(r.sessions),
    days,
    videos,
    sites,
  };
}

/**
 * Serverless friends: requests travel through the recipient's public "inbox" room; once
 * accepted, both sides meet in a private room protected by a shared secret and exchange
 * presence, profile statistics and room invitations there. Everything is peer-to-peer.
 */
export class FriendsManager {
  private data: FriendsData;
  private presence = new Map<string, Presence>();
  private pairs = new Map<string, { channel: Channel; peers: Set<string> }>();
  private outbox = new Map<string, Channel>();
  private inbox: Channel | null = null;
  private inboxPeers = new Map<string, string>(); // peerId -> claimed pub
  private listeners = new Set<(s: FriendsSnapshot) => void>();
  private selfStatus: 'idle' | 'watching' = 'idle';
  private stopped = true;
  private factory: ChannelFactory;
  private self: FriendsSelf;
  private snapshotCache: FriendsSnapshot | null = null;

  constructor(private opts: FriendsOptions) {
    this.factory = opts.channel ?? trysteroChannel;
    this.self = opts.self;
    this.data = opts.storage.load();
  }

  get pub(): string {
    return this.self.pub;
  }

  snapshot(): FriendsSnapshot {
    if (!this.snapshotCache)
      this.snapshotCache = {
        friends: [...this.data.friends],
        incoming: [...this.data.incoming],
        outgoing: [...this.data.outgoing],
        presence: Object.fromEntries(this.presence),
      };
    return this.snapshotCache;
  }

  subscribe(listener: (s: FriendsSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(persist = false): void {
    if (persist) this.opts.storage.save(this.data);
    this.snapshotCache = null;
    const s = this.snapshot();
    for (const l of this.listeners) l(s);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const now = Date.now();
    this.data.outgoing = this.data.outgoing.filter((o) => now - o.at < REQUEST_TTL_MS);
    this.data.incoming = this.data.incoming.filter((o) => now - o.at < REQUEST_TTL_MS);
    this.inbox = this.openInbox();
    for (const f of this.data.friends) void this.openPair(f);
    for (const o of this.data.outgoing) this.openOutbox(o.pub);
    this.emit(true);
  }

  stop(): void {
    this.stopped = true;
    this.inbox?.leave();
    this.inbox = null;
    for (const p of this.pairs.values()) p.channel.leave();
    for (const c of this.outbox.values()) c.leave();
    this.pairs.clear();
    this.outbox.clear();
    this.inboxPeers.clear();
    this.presence.clear();
    this.emit();
  }

  // ───────── own profile ─────────
  updateSelf(patch: Partial<Pick<FriendsSelf, 'name' | 'avatar'>>): void {
    this.self = { ...this.self, ...patch };
    this.broadcastHello();
  }

  setStatus(status: 'idle' | 'watching'): void {
    if (this.selfStatus === status) return;
    this.selfStatus = status;
    this.broadcastHello();
  }

  /** Call after statistics changed (e.g. a room ended) to refresh friends' view of us. */
  shareStats(): void {
    const stats = this.opts.getStats?.();
    if (!stats) return;
    for (const p of this.pairs.values()) p.channel.send({ t: 'stats', stats });
  }

  private broadcastHello(): void {
    for (const p of this.pairs.values()) this.sendHello(p.channel);
  }

  private sendHello(channel: Channel, peerId?: string): void {
    channel.send(
      { t: 'hello', name: this.self.name.slice(0, 24), status: this.selfStatus },
      peerId,
    );
    if (this.self.avatar && this.self.avatar.length <= AVATAR_MAX)
      channel.send({ t: 'avatar', avatar: this.self.avatar }, peerId);
    const stats = this.opts.getStats?.();
    if (stats) channel.send({ t: 'stats', stats }, peerId);
  }

  // ───────── requests ─────────
  /** Sends a friend request to the owner of a friend code. */
  sendRequest(code: string): 'ok' | 'invalid' | 'self' | 'known' {
    const pub = parseFriendCode(code);
    if (!pub) return 'invalid';
    if (pub === this.self.pub) return 'self';
    if (this.data.friends.some((f) => f.pub === pub)) return 'known';
    const incoming = this.data.incoming.find((r) => r.pub === pub);
    if (incoming) {
      void this.accept(pub);
      return 'ok';
    }
    if (!this.data.outgoing.some((o) => o.pub === pub)) {
      this.data.outgoing.push({ pub, at: Date.now() });
      this.emit(true);
    }
    this.openOutbox(pub);
    return 'ok';
  }

  cancelRequest(pub: string): void {
    this.data.outgoing = this.data.outgoing.filter((o) => o.pub !== pub);
    this.outbox.get(pub)?.leave();
    this.outbox.delete(pub);
    this.emit(true);
  }

  decline(pub: string): void {
    const req = this.data.incoming.find((r) => r.pub === pub);
    this.data.incoming = this.data.incoming.filter((r) => r.pub !== pub);
    this.emit(true);
    if (req)
      for (const [peer, claimed] of this.inboxPeers)
        if (claimed === pub) this.inbox?.send({ t: 'decline' }, peer);
  }

  async accept(pub: string): Promise<void> {
    const req = this.data.incoming.find((r) => r.pub === pub);
    if (!req) return;
    this.data.incoming = this.data.incoming.filter((r) => r.pub !== pub);
    const friend: Friend = {
      pub,
      name: req.name,
      avatar: req.avatar,
      secret: randomHex(),
      since: Date.now(),
    };
    this.data.friends.push(friend);
    this.emit(true);
    this.replyAccept(friend);
    await this.openPair(friend);
  }

  remove(pub: string): void {
    this.data.friends = this.data.friends.filter((f) => f.pub !== pub);
    const pair = this.pairs.get(pub);
    pair?.channel.send({ t: 'bye' });
    pair?.channel.leave();
    this.pairs.delete(pub);
    this.presence.delete(pub);
    this.emit(true);
  }

  private replyAccept(friend: Friend): void {
    for (const [peer, claimed] of this.inboxPeers)
      if (claimed === friend.pub)
        this.inbox?.send(
          {
            t: 'accept',
            secret: friend.secret,
            name: this.self.name.slice(0, 24),
            avatar: this.self.avatar,
          },
          peer,
        );
  }

  private openInbox(): Channel {
    return this.factory(
      {
        roomName: `inbox-${this.self.pub}`,
        password: INBOX_PASSWORD,
        relayUrls: this.opts.relayUrls,
        testOnlyLoopback: this.opts.testOnlyLoopback,
      },
      {
        onPeerJoin: () => {},
        onPeerLeave: (peer) => this.inboxPeers.delete(peer),
        onMessage: (msg, peer) => this.onInbox(msg, peer),
      },
    );
  }

  private onInbox(raw: unknown, peer: string): void {
    const m = raw as Record<string, unknown>;
    if (m?.t !== 'req') return;
    const pub = typeof m.pub === 'string' && PUB.test(m.pub) ? m.pub : '';
    if (!pub || pub === this.self.pub) return;
    this.inboxPeers.set(peer, pub);
    const known = this.data.friends.find((f) => f.pub === pub);
    if (known) {
      // They lost the accept (or re-installed): resend the secret.
      this.replyAccept(known);
      return;
    }
    const name = str(m.name, 24).trim() || 'Guest';
    const avatar = avatarOf(m.avatar);
    if (this.data.outgoing.some((o) => o.pub === pub)) {
      // Both sides asked each other: the smaller id accepts, the other waits for the secret.
      if (this.self.pub > pub) return;
      this.data.incoming.push({ pub, name, avatar, at: Date.now() });
      this.data.outgoing = this.data.outgoing.filter((o) => o.pub !== pub);
      this.outbox.get(pub)?.leave();
      this.outbox.delete(pub);
      void this.accept(pub);
      return;
    }
    const existing = this.data.incoming.find((r) => r.pub === pub);
    if (existing) {
      existing.name = name;
      existing.avatar = avatar;
    } else if (this.data.incoming.length < MAX_INCOMING) {
      this.data.incoming.push({ pub, name, avatar, at: Date.now() });
    } else return;
    this.emit(true);
  }

  private openOutbox(pub: string): void {
    if (this.stopped || this.outbox.has(pub)) return;
    const channel: Channel = this.factory(
      {
        roomName: `inbox-${pub}`,
        password: INBOX_PASSWORD,
        relayUrls: this.opts.relayUrls,
        testOnlyLoopback: this.opts.testOnlyLoopback,
      },
      {
        onPeerJoin: (peer) =>
          channel.send(
            {
              t: 'req',
              pub: this.self.pub,
              name: this.self.name.slice(0, 24),
              avatar:
                this.self.avatar && this.self.avatar.length <= AVATAR_MAX
                  ? this.self.avatar
                  : undefined,
            },
            peer,
          ),
        onPeerLeave: () => {},
        onMessage: (raw) => {
          const m = raw as Record<string, unknown>;
          if (m?.t === 'decline') {
            this.cancelRequest(pub);
            return;
          }
          if (m?.t !== 'accept' || typeof m.secret !== 'string' || !SECRET.test(m.secret)) return;
          if (!this.data.outgoing.some((o) => o.pub === pub)) return;
          this.data.outgoing = this.data.outgoing.filter((o) => o.pub !== pub);
          const friend: Friend = {
            pub,
            name: str(m.name, 24).trim() || 'Friend',
            avatar: avatarOf(m.avatar),
            secret: m.secret,
            since: Date.now(),
          };
          this.data.friends = [...this.data.friends.filter((f) => f.pub !== pub), friend];
          this.outbox.get(pub)?.leave();
          this.outbox.delete(pub);
          this.emit(true);
          void this.openPair(friend);
        },
      },
    );
    this.outbox.set(pub, channel);
  }

  // ───────── private pair room ─────────
  private async openPair(friend: Friend): Promise<void> {
    if (this.stopped || this.pairs.has(friend.pub)) return;
    const roomName = await pairRoom(this.self.pub, friend.pub);
    if (this.stopped || this.pairs.has(friend.pub)) return;
    const entry = { channel: null as unknown as Channel, peers: new Set<string>() };
    entry.channel = this.factory(
      {
        roomName,
        password: friend.secret,
        relayUrls: this.opts.relayUrls,
        testOnlyLoopback: this.opts.testOnlyLoopback,
      },
      {
        onPeerJoin: (peer) => {
          entry.peers.add(peer);
          this.setPresence(friend.pub, { online: true });
          this.sendHello(entry.channel, peer);
        },
        onPeerLeave: (peer) => {
          entry.peers.delete(peer);
          if (entry.peers.size) return;
          const f = this.data.friends.find((x) => x.pub === friend.pub);
          if (f) f.lastSeen = Date.now();
          this.setPresence(friend.pub, { online: false, status: 'idle', invite: undefined });
          this.emit(true);
        },
        onMessage: (msg) => this.onPair(friend.pub, msg),
      },
    );
    this.pairs.set(friend.pub, entry);
  }

  private setPresence(pub: string, patch: Partial<Presence>): void {
    const cur = this.presence.get(pub) ?? { online: false, status: 'idle' as const };
    this.presence.set(pub, { ...cur, ...patch });
    this.emit();
  }

  private onPair(pub: string, raw: unknown): void {
    const m = raw as Record<string, unknown>;
    const friend = this.data.friends.find((f) => f.pub === pub);
    if (!friend || !m) return;
    switch (m.t) {
      case 'hello': {
        const name = str(m.name, 24).trim();
        if (name) friend.name = name;
        this.setPresence(pub, {
          online: true,
          status: m.status === 'watching' ? 'watching' : 'idle',
        });
        this.emit(true);
        break;
      }
      case 'avatar': {
        const a = avatarOf(m.avatar);
        if (a) {
          friend.avatar = a;
          this.emit(true);
        }
        break;
      }
      case 'stats': {
        const stats = sanitizeStats(m.stats);
        if (stats) {
          friend.stats = stats;
          this.emit(true);
        }
        break;
      }
      case 'invite': {
        const code = str(m.code, 300);
        if (!/^wl:\/\/join#/.test(code)) return;
        this.setPresence(pub, {
          invite: { code, title: str(m.title, 100), at: Date.now() },
        });
        break;
      }
      case 'uninvite':
        this.setPresence(pub, { invite: undefined });
        break;
      case 'bye':
        this.data.friends = this.data.friends.filter((f) => f.pub !== pub);
        this.pairs.get(pub)?.channel.leave();
        this.pairs.delete(pub);
        this.presence.delete(pub);
        this.emit(true);
        break;
    }
  }

  // ───────── invitations ─────────
  /** Sends a room invite to the given friends (online ones receive it immediately). */
  invite(pubs: string[], code: string, title = ''): void {
    for (const pub of pubs)
      this.pairs.get(pub)?.channel.send({ t: 'invite', code, title: title.slice(0, 100) });
  }

  withdrawInvites(): void {
    for (const p of this.pairs.values()) p.channel.send({ t: 'uninvite' });
  }

  dismissInvite(pub: string): void {
    this.setPresence(pub, { invite: undefined });
  }
}
