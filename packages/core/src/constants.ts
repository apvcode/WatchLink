/**
 * WatchLink System Constants
 * Kept in ONE file so configuration is centralized.
 */

export const APP_NAME = 'WatchLink';

export const PROTOCOL_VERSION = 2;

export const MAX_MESSAGE_BYTES = 8192; // 8 KB hard constraint
export const RATE_LIMIT_MSG_PER_SEC = 20;
export const MAX_PEERS_PER_ROOM = 8; // 9th gets "room is full"

export const SCHEDULED_START_OFFSET_MS = 250; // synchronized resume delay

export const DRIFT_DEADBAND_SEC = 3; // < 3 s -> do nothing (no stutter)
export const DRIFT_NUDGE_MAX_SEC = 10; // 3-10 s -> nudge rate by 5%, beyond -> hard seek
export const HOLD_TOLERANCE_SEC = 0.15; // while the room is held, stay tight
export const DRIFT_NUDGE_RATE = 0.05; // 5% rate nudge (0.95 or 1.05)
export const DRIFT_TICK_INTERVAL_MS = 500; // tick every 500 ms

export const CLOCK_PING_BURST_COUNT = 5;
export const CLOCK_PING_INTERVAL_MS = 2000;
export const STATE_BROADCAST_INTERVAL_MS = 2000;

export const SIGNALING_FALLBACK_TIMEOUT_MS = 8000; // 8s Nostr -> MQTT
export const IMG_CHUNK_CHARS = 6000; // base64 chars per photo chunk (< MAX_MESSAGE_BYTES with envelope)
export const IMG_MAX_CHUNKS = 40; // ~180 KB of JPEG per photo
export const IMG_CHUNK_INTERVAL_MS = 70; // stay under the 20 msg/s rate limit
export const CREATOR_GRACE_MS = 90000; // host may reconnect this long without losing control
export const JOIN_TIMEOUT_MS = 28000; // guest gives up when no peer answers

// Trystero picks only 5 random relays out of 29 stale defaults, mostly dead, so two peers
// often share no live relay. Connect to this curated set instead (all of them, as redundancy).
export const NOSTR_RELAYS = [
  'relay.damus.io',
  'nos.lol',
  'relay.primal.net',
  'offchain.pub',
  'nostr.mom',
  'nostr.oxtr.dev',
  'nostr-pub.wellorder.net',
  'relay.nostr.band',
  'cdn.satellite.earth',
  'relay.aarpia.com',
  'nostr.wine',
  'purplepag.es',
  'relay.snort.social',
  'nostr.einundzwanzig.space',
  'relay.nostr.bg',
  'strfry.iris.to',
].map((h) => `wss://${h}`);
export const REJOIN_EVERY_MS = 6000; // a guest alone in the room re-announces this often
