/**
 * Protocol Message Specifications (v: 2)
 */
import { PROTOCOL_VERSION } from './constants.js';

export { PROTOCOL_VERSION };

export type MessageType =
  | 'control'
  | 'hello'
  | 'clock.ping'
  | 'clock.pong'
  | 'cmd'
  | 'state'
  | 'buffering'
  | 'ready'
  | 'chat'
  | 'img'
  | 'bye'
  | 'error';

export type CommandAction = 'play' | 'pause' | 'seek' | 'rate' | 'nav';

export interface BaseMsg {
  v: 2;
  type: MessageType;
}

export interface HelloMsg extends BaseMsg {
  type: 'hello';
  peerId: string;
  name: string;
  /** Stable device identity (never shown in the UI). */
  uid?: string;
  /** Small data: URL (<= 5 KB). Optional. */
  avatar?: string;
}

export interface ClockPingMsg extends BaseMsg {
  type: 'clock.ping';
  t0: number; // sender timestamp
}

export interface ClockPongMsg extends BaseMsg {
  type: 'clock.pong';
  t0: number; // echoed sender timestamp
  t1: number; // leader receive timestamp
  t2: number; // leader reply timestamp
}

export interface CmdMsg extends BaseMsg {
  type: 'cmd';
  lamport: number;
  from: string;
  action: CommandAction;
  position?: number;
  rate?: number;
  url?: string;
  startAt?: number;
}

export interface StateMsg extends BaseMsg {
  type: 'state';
  url: string;
  playing: boolean;
  position: number;
  rate: number;
  at: number; // room timestamp when snapshot was taken
  hold: boolean;
  holdBy?: string;
  ownerId?: string;
  hostOnlyControls?: boolean;
  lamport?: number;
  lastCmdPeer?: string;
}

export interface BufferingMsg extends BaseMsg {
  type: 'buffering';
  peerId: string;
  on: boolean;
}

export interface ReadyMsg extends BaseMsg {
  type: 'ready';
  peerId: string;
}

export interface ChatMsg extends BaseMsg {
  type: 'chat';
  id: string;
  text: string;
  ts: number;
}

/** One base64 JPEG chunk of a photo; photos are split to fit the 8 KB message limit. */
export interface ImgMsg extends BaseMsg {
  type: 'img';
  id: string;
  ts: number;
  /** Chunk index, 0-based. */
  i: number;
  /** Total number of chunks. */
  n: number;
  /** Base64 payload of this chunk. */
  d: string;
}

export interface ByeMsg extends BaseMsg {
  type: 'bye';
  peerId: string;
}

export interface ErrorMsg extends BaseMsg {
  type: 'error';
  code: 'ROOM_FULL' | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'MALFORMED';
  message: string;
}

export interface ControlMsg extends BaseMsg {
  type: 'control';
  ownerId: string;
  hostOnlyControls: boolean;
}

export type ProtocolMsg =
  | ControlMsg
  | HelloMsg
  | ClockPingMsg
  | ClockPongMsg
  | CmdMsg
  | StateMsg
  | BufferingMsg
  | ReadyMsg
  | ChatMsg
  | ImgMsg
  | ByeMsg
  | ErrorMsg;

export interface PlayerStateEvent {
  playing: boolean;
  position: number;
  rate: number;
  duration: number;
  buffering: boolean;
  adPlaying: boolean;
  url: string;
  origin: 'user' | 'program';
}

export type SignalingStrategy = 'nostr' | 'mqtt';
