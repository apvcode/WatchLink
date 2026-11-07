import {
  CHAT_REPLY_MAX,
  IMG_CHUNK_CHARS,
  IMG_MAX_CHUNKS,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  RATE_LIMIT_MSG_PER_SEC,
} from './constants.js';
import type { ChatReply, CommandAction, MessageType, ProtocolMsg } from './types.js';

interface RateLimiterEntry {
  tokens: number;
  lastRefill: number;
}

export class MessageValidator {
  private peerLimiters = new Map<string, RateLimiterEntry>();
  private readonly maxTokens: number;
  private readonly refillRatePerMs: number;

  constructor(maxTokens = RATE_LIMIT_MSG_PER_SEC, refillRatePerSec = RATE_LIMIT_MSG_PER_SEC) {
    this.maxTokens = maxTokens;
    this.refillRatePerMs = refillRatePerSec / 1000;
  }

  public checkRateLimit(peerId: string, now = Date.now()): boolean {
    let entry = this.peerLimiters.get(peerId);
    if (!entry) {
      entry = { tokens: this.maxTokens - 1, lastRefill: now };
      this.peerLimiters.set(peerId, entry);
      return true;
    }

    const elapsed = Math.max(0, now - entry.lastRefill);
    entry.tokens = Math.min(this.maxTokens, entry.tokens + elapsed * this.refillRatePerMs);
    entry.lastRefill = now;

    if (entry.tokens >= 1) {
      entry.tokens -= 1;
      return true;
    }

    return false;
  }

  public removePeer(peerId: string): void {
    this.peerLimiters.delete(peerId);
  }

  public parseAndValidate(
    raw: unknown,
    peerId: string,
    now = Date.now(),
  ): { valid: true; msg: ProtocolMsg } | { valid: false; reason: string } {
    // 1. Rate limit check
    if (!this.checkRateLimit(peerId, now)) {
      return { valid: false, reason: 'RATE_LIMIT_EXCEEDED' };
    }

    // 2. Size check
    let text: string;
    if (typeof raw === 'string') {
      text = raw;
    } else if (raw instanceof Uint8Array || raw instanceof ArrayBuffer) {
      const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
      if (bytes.byteLength > MAX_MESSAGE_BYTES) {
        return { valid: false, reason: 'PAYLOAD_TOO_LARGE' };
      }
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        return { valid: false, reason: 'INVALID_UTF8' };
      }
    } else if (typeof raw === 'object' && raw !== null) {
      // Direct object passed via memory / fake transport
      try {
        text = JSON.stringify(raw);
      } catch {
        return { valid: false, reason: 'SERIALIZATION_FAILED' };
      }
    } else {
      return { valid: false, reason: 'INVALID_TYPE' };
    }

    if (text.length > MAX_MESSAGE_BYTES) {
      return { valid: false, reason: 'PAYLOAD_TOO_LARGE' };
    }

    // 3. JSON parse
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { valid: false, reason: 'MALFORMED_JSON' };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { valid: false, reason: 'PAYLOAD_NOT_OBJECT' };
    }

    // 4. Version check
    if (parsed.v !== PROTOCOL_VERSION) {
      return { valid: false, reason: 'UNSUPPORTED_VERSION' };
    }

    // 5. Message type check
    const type = parsed.type;
    if (typeof type !== 'string') {
      return { valid: false, reason: 'MISSING_TYPE' };
    }

    return this.validateSpecificType(type as MessageType, parsed, peerId);
  }

  private validateSpecificType(
    type: MessageType,
    data: Record<string, unknown>,
    peerId: string,
  ): { valid: true; msg: ProtocolMsg } | { valid: false; reason: string } {
    switch (type) {
      case 'control': {
        if (
          typeof data.ownerId !== 'string' ||
          data.ownerId.length > 64 ||
          typeof data.hostOnlyControls !== 'boolean'
        )
          return { valid: false, reason: 'INVALID_CONTROL' };
        return {
          valid: true,
          msg: {
            v: 2,
            type: 'control',
            ownerId: data.ownerId,
            hostOnlyControls: data.hostOnlyControls,
          },
        };
      }
      case 'hello': {
        if (data.peerId !== peerId) return { valid: false, reason: 'SENDER_MISMATCH' };
        if (
          typeof data.peerId !== 'string' ||
          data.peerId.length === 0 ||
          data.peerId.length > 64
        ) {
          return { valid: false, reason: 'INVALID_PEER_ID' };
        }
        if (typeof data.name !== 'string' || data.name.length === 0 || data.name.length > 50) {
          return { valid: false, reason: 'INVALID_NAME' };
        }
        if (
          data.uid !== undefined &&
          (typeof data.uid !== 'string' || !/^[a-f0-9]{16,64}$/.test(data.uid))
        )
          return { valid: false, reason: 'INVALID_UID' };
        if (
          data.avatar !== undefined &&
          (typeof data.avatar !== 'string' ||
            data.avatar.length > 5500 ||
            !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data.avatar))
        )
          return { valid: false, reason: 'INVALID_AVATAR' };
        return {
          valid: true,
          msg: {
            v: 2,
            type: 'hello',
            peerId: data.peerId,
            name: data.name,
            uid: data.uid as string | undefined,
            avatar: data.avatar as string | undefined,
          },
        };
      }

      case 'clock.ping': {
        if (typeof data.t0 !== 'number' || !Number.isFinite(data.t0) || data.t0 < 0) {
          return { valid: false, reason: 'INVALID_TIMESTAMP' };
        }
        return {
          valid: true,
          msg: { v: 2, type: 'clock.ping', t0: data.t0 },
        };
      }

      case 'clock.pong': {
        if (
          typeof data.t0 !== 'number' ||
          typeof data.t1 !== 'number' ||
          typeof data.t2 !== 'number' ||
          !Number.isFinite(data.t0) ||
          !Number.isFinite(data.t1) ||
          !Number.isFinite(data.t2)
        ) {
          return { valid: false, reason: 'INVALID_PONG_TIMESTAMPS' };
        }
        return {
          valid: true,
          msg: { v: 2, type: 'clock.pong', t0: data.t0, t1: data.t1, t2: data.t2 },
        };
      }

      case 'cmd': {
        if (data.from !== peerId) return { valid: false, reason: 'SENDER_MISMATCH' };
        if (
          typeof data.lamport !== 'number' ||
          !Number.isInteger(data.lamport) ||
          data.lamport < 0
        ) {
          return { valid: false, reason: 'INVALID_LAMPORT' };
        }
        if (typeof data.from !== 'string' || data.from.length === 0) {
          return { valid: false, reason: 'INVALID_CMD_FROM' };
        }
        const validActions: CommandAction[] = ['play', 'pause', 'seek', 'rate', 'nav'];
        if (!validActions.includes(data.action as CommandAction)) {
          return { valid: false, reason: 'INVALID_ACTION' };
        }
        if (
          data.position !== undefined &&
          (typeof data.position !== 'number' ||
            !Number.isFinite(data.position) ||
            data.position < 0)
        ) {
          return { valid: false, reason: 'INVALID_POSITION' };
        }
        if (
          data.rate !== undefined &&
          (typeof data.rate !== 'number' ||
            !Number.isFinite(data.rate) ||
            data.rate <= 0 ||
            data.rate > 16)
        ) {
          return { valid: false, reason: 'INVALID_RATE' };
        }
        if (data.url !== undefined) {
          if (typeof data.url !== 'string' || data.url.length > 2048) {
            return { valid: false, reason: 'INVALID_URL' };
          }
        }
        if (
          data.startAt !== undefined &&
          (typeof data.startAt !== 'number' || !Number.isFinite(data.startAt) || data.startAt < 0)
        ) {
          return { valid: false, reason: 'INVALID_START_AT' };
        }

        return {
          valid: true,
          msg: {
            v: 2,
            type: 'cmd',
            lamport: data.lamport,
            from: data.from,
            action: data.action as CommandAction,
            position: data.position as number | undefined,
            rate: data.rate as number | undefined,
            url: data.url as string | undefined,
            startAt: data.startAt as number | undefined,
          },
        };
      }

      case 'state': {
        if (
          data.ownerId !== undefined &&
          (typeof data.ownerId !== 'string' || data.ownerId.length > 64)
        )
          return { valid: false, reason: 'INVALID_OWNER' };
        if (
          data.lamport !== undefined &&
          (!Number.isSafeInteger(data.lamport) || (data.lamport as number) < 0)
        )
          return { valid: false, reason: 'INVALID_LAMPORT' };
        if (data.hostOnlyControls !== undefined && typeof data.hostOnlyControls !== 'boolean')
          return { valid: false, reason: 'INVALID_CONTROL' };
        if (data.lastCmdPeer !== undefined && typeof data.lastCmdPeer !== 'string')
          return { valid: false, reason: 'INVALID_PEER_ID' };
        if (typeof data.url !== 'string' || data.url.length > 2048) {
          return { valid: false, reason: 'INVALID_URL' };
        }
        if (typeof data.playing !== 'boolean') {
          return { valid: false, reason: 'INVALID_PLAYING' };
        }
        if (
          typeof data.position !== 'number' ||
          !Number.isFinite(data.position) ||
          data.position < 0
        ) {
          return { valid: false, reason: 'INVALID_POSITION' };
        }
        if (
          typeof data.rate !== 'number' ||
          !Number.isFinite(data.rate) ||
          data.rate <= 0 ||
          data.rate > 16
        ) {
          return { valid: false, reason: 'INVALID_RATE' };
        }
        if (typeof data.at !== 'number' || !Number.isFinite(data.at) || data.at < 0) {
          return { valid: false, reason: 'INVALID_AT' };
        }
        if (typeof data.hold !== 'boolean') {
          return { valid: false, reason: 'INVALID_HOLD' };
        }
        if (data.holdBy !== undefined && typeof data.holdBy !== 'string') {
          return { valid: false, reason: 'INVALID_HOLD_BY' };
        }

        return {
          valid: true,
          msg: {
            v: 2,
            type: 'state',
            url: data.url,
            playing: data.playing,
            position: data.position,
            rate: data.rate,
            at: data.at,
            hold: data.hold,
            holdBy: data.holdBy as string | undefined,
            ownerId: data.ownerId as string | undefined,
            hostOnlyControls: data.hostOnlyControls as boolean | undefined,
            lamport: data.lamport as number | undefined,
            lastCmdPeer: data.lastCmdPeer as string | undefined,
          },
        };
      }

      case 'buffering': {
        if (typeof data.peerId !== 'string' || typeof data.on !== 'boolean') {
          return { valid: false, reason: 'INVALID_BUFFERING_FIELDS' };
        }
        return {
          valid: true,
          msg: { v: 2, type: 'buffering', peerId: data.peerId, on: data.on },
        };
      }

      case 'ready': {
        if (typeof data.peerId !== 'string') {
          return { valid: false, reason: 'INVALID_READY_FIELDS' };
        }
        return {
          valid: true,
          msg: { v: 2, type: 'ready', peerId: data.peerId },
        };
      }

      case 'chat': {
        if (typeof data.id !== 'string' || data.id.length === 0 || data.id.length > 64) {
          return { valid: false, reason: 'INVALID_CHAT_ID' };
        }
        if (typeof data.text !== 'string' || data.text.length === 0 || data.text.length > 1000) {
          return { valid: false, reason: 'INVALID_CHAT_TEXT' };
        }
        if (typeof data.ts !== 'number' || !Number.isFinite(data.ts)) {
          return { valid: false, reason: 'INVALID_CHAT_TS' };
        }
        let re: ChatReply | undefined;
        if (data.re !== undefined) {
          const r = data.re as Record<string, unknown> | null;
          if (
            !r ||
            typeof r !== 'object' ||
            typeof r.id !== 'string' ||
            r.id.length === 0 ||
            r.id.length > 64 ||
            typeof r.name !== 'string' ||
            r.name.length > 48 ||
            typeof r.text !== 'string' ||
            r.text.length > CHAT_REPLY_MAX ||
            (r.img !== undefined && typeof r.img !== 'boolean')
          ) {
            return { valid: false, reason: 'INVALID_CHAT_REPLY' };
          }
          re = { id: r.id, name: r.name, text: r.text, ...(r.img ? { img: true } : {}) };
        }
        return {
          valid: true,
          msg: {
            v: 2,
            type: 'chat',
            id: data.id,
            text: data.text,
            ts: data.ts,
            ...(re ? { re } : {}),
          },
        };
      }

      case 'img': {
        if (typeof data.id !== 'string' || data.id.length === 0 || data.id.length > 64) {
          return { valid: false, reason: 'INVALID_IMG_ID' };
        }
        if (typeof data.ts !== 'number' || !Number.isFinite(data.ts)) {
          return { valid: false, reason: 'INVALID_IMG_TS' };
        }
        const { i, n, d } = data;
        if (
          typeof n !== 'number' ||
          !Number.isInteger(n) ||
          n < 1 ||
          n > IMG_MAX_CHUNKS ||
          typeof i !== 'number' ||
          !Number.isInteger(i) ||
          i < 0 ||
          i >= n
        ) {
          return { valid: false, reason: 'INVALID_IMG_INDEX' };
        }
        if (
          typeof d !== 'string' ||
          d.length === 0 ||
          d.length > IMG_CHUNK_CHARS ||
          !/^[A-Za-z0-9+/=]+$/.test(d)
        ) {
          return { valid: false, reason: 'INVALID_IMG_DATA' };
        }
        return { valid: true, msg: { v: 2, type: 'img', id: data.id, ts: data.ts, i, n, d } };
      }

      case 'bye': {
        if (typeof data.peerId !== 'string') {
          return { valid: false, reason: 'INVALID_BYE_FIELDS' };
        }
        return {
          valid: true,
          msg: { v: 2, type: 'bye', peerId: data.peerId },
        };
      }

      case 'error': {
        if (typeof data.code !== 'string' || typeof data.message !== 'string') {
          return { valid: false, reason: 'INVALID_ERROR_FIELDS' };
        }
        return {
          valid: true,
          msg: {
            v: 2,
            type: 'error',
            code: data.code as 'ROOM_FULL' | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'MALFORMED',
            message: data.message,
          },
        };
      }

      default:
        return { valid: false, reason: `UNKNOWN_MESSAGE_TYPE: ${type}` };
    }
  }
}
