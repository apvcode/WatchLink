import { joinRoom as joinMqttRoom, getRelaySockets as mqttSockets } from '@trystero-p2p/mqtt';
import { joinRoom as joinNostrRoom, getRelaySockets as nostrSockets } from '@trystero-p2p/nostr';
import { APP_NAME, NOSTR_RELAYS, SIGNALING_FALLBACK_TIMEOUT_MS } from './constants.js';

export function rtcOptions(testOnly?: boolean) {
  if (testOnly) return {};
  return {
    turnConfig: turnServers,
    rtcConfig: { iceServers: [...EXTRA_STUN, ...turnServers], iceCandidatePoolSize: 4 },
  };
}

/** A small named rendezvous room that exchanges JSON messages with whoever joins it. */
export interface Channel {
  send(msg: unknown, peerId?: string): void;
  leave(): void;
}

export interface ChannelHandlers {
  onPeerJoin(peerId: string): void;
  onPeerLeave(peerId: string): void;
  onMessage(msg: unknown, peerId: string): void;
}

export interface ChannelOptions {
  roomName: string;
  password: string;
  relayUrls?: string[];
  testOnlyLoopback?: boolean;
}

export type ChannelFactory = (opts: ChannelOptions, handlers: ChannelHandlers) => Channel;

const MAX_BYTES = 8192;

export interface TurnServer {
  urls: string | string[];
  username: string;
  credential: string;
}

/**
 * Mobile carriers (CGNAT / symmetric NAT) block direct WebRTC, so STUN alone is not
 * enough there: a TURN relay (traffic stays end-to-end encrypted) is required. No free
 * public TURN is reliable (Open Relay now resolves to 192.0.2.1), so servers are supplied
 * by the app: VITE_WATCHLINK_TURN at build time or localStorage 'watchlink:turn' (JSON).
 */
let turnServers: TurnServer[] = [];
export function setTurnServers(list: TurnServer[]): void {
  turnServers = list.filter((s) => s?.urls && s.username && s.credential);
}
const EXTRA_STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** Production factory: Nostr first, MQTT added when no Nostr relay is reachable after 8 s. */
export const trysteroChannel: ChannelFactory = (opts, handlers) => {
  const rooms: Array<{
    room: ReturnType<typeof joinNostrRoom>;
    send: (data: string, peer?: string) => Promise<unknown>;
    strategy: 'nostr' | 'mqtt';
  }> = [];
  const routes = new Map<string, Set<'nostr' | 'mqtt'>>();
  let dead = false;

  const add = (strategy: 'nostr' | 'mqtt') => {
    if (dead || rooms.some((r) => r.strategy === strategy)) return;
    try {
      const room = (strategy === 'nostr' ? joinNostrRoom : joinMqttRoom)(
        {
          appId: APP_NAME.toLowerCase(),
          relayConfig: strategy === 'nostr' ? { urls: opts.relayUrls ?? NOSTR_RELAYS } : undefined,
          ...rtcOptions(opts.testOnlyLoopback),
          _test_only_mdnsHostFallbackToLoopback: opts.testOnlyLoopback,
          password: opts.password,
        },
        opts.roomName,
      );
      const action = room.makeAction<string>('wl-f1');
      action.onReceive = ({ byteLength }) => byteLength <= MAX_BYTES;
      action.onMessage = (data, { peerId }) => {
        const r = routes.get(peerId);
        // one deterministic route per peer, like rooms
        if (!r?.has(strategy)) return;
        try {
          handlers.onMessage(JSON.parse(String(data)), peerId);
        } catch {}
      };
      room.onPeerJoin = (peerId) => {
        const known = routes.get(peerId);
        const first = !known;
        const r = known ?? new Set<'nostr' | 'mqtt'>();
        routes.set(peerId, r);
        r.add(strategy);
        if (first) handlers.onPeerJoin(peerId);
      };
      room.onPeerLeave = (peerId) => {
        const r = routes.get(peerId);
        r?.delete(strategy);
        if (r?.size) return;
        routes.delete(peerId);
        handlers.onPeerLeave(peerId);
      };
      rooms.push({
        room,
        strategy,
        send: (data, peer) => action.send(data, { target: peer }),
      });
    } catch {}
  };

  // Join both signaling networks at once: if one is blocked on the user's network
  // (mobile ISP, VPN) the other still lets peers find each other. A fixed test
  // relay keeps the single-strategy behaviour.
  add('nostr');
  if (!opts.relayUrls) add('mqtt');
  const timer = setTimeout(() => {
    const up = Object.values(nostrSockets()).some((s: any) => s.readyState === 1);
    if (!up) add('mqtt');
  }, SIGNALING_FALLBACK_TIMEOUT_MS);
  void mqttSockets;

  return {
    send(msg, peerId) {
      const data = JSON.stringify(msg);
      if (data.length > MAX_BYTES) return;
      const ids = peerId ? [peerId] : [...routes.keys()];
      for (const id of ids) {
        const strategy = routes.get(id)?.has('nostr') ? 'nostr' : 'mqtt';
        void rooms
          .find((r) => r.strategy === strategy)
          ?.send(data, id)
          .catch(() => {});
      }
    },
    leave() {
      dead = true;
      clearTimeout(timer);
      for (const r of rooms) r.room.leave();
      rooms.length = 0;
      routes.clear();
    },
  };
};
