import { RoomClock } from './clock.js';
import {
  CREATOR_GRACE_MS,
  DRIFT_NUDGE_MAX_SEC,
  MAX_PEERS_PER_ROOM,
  SCHEDULED_START_OFFSET_MS,
  STATE_BROADCAST_INTERVAL_MS,
} from './constants.js';
import { DriftController, type DriftCorrection } from './drift-controller.js';
import type {
  BufferingMsg,
  CmdMsg,
  CommandAction,
  HelloMsg,
  PlayerStateEvent,
  ProtocolMsg,
  StateMsg,
} from './types.js';

const MAX_LAMPORT_JUMP = 1_000_000;

export interface SyncEngineConfig {
  selfId: string;
  selfName: string;
  awaitingState?: boolean;
  bufferingDelayMs?: number;
  roomCreatorId?: string;
  hostOnlyControls?: boolean;
  nowFn?: () => number;
}

export type OutboundHandler = (msg: ProtocolMsg, targetPeerId?: string) => void;
export type LocalActionHandler = (action: {
  type: 'play' | 'pause' | 'seek' | 'rate' | 'nav';
  position?: number;
  rate?: number;
  url?: string;
  startAt?: number;
}) => void;

export class SyncEngine {
  public readonly selfId: string;
  public readonly selfName: string;
  public roomCreatorId: string;
  public hostOnlyControls: boolean;
  public readonly nowFn: () => number;

  public readonly clock: RoomClock;
  public readonly driftController: DriftController;

  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeekAt = 0;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private localAdPlaying = false;
  private localPlayerAt = 0;
  private localPlayerReady = false;
  private bufferDebounce: ReturnType<typeof setTimeout> | null = null;
  private bufferingDelayMs: number;
  private barrierCooldownUntil = 0;
  private awaitingState: boolean;
  private pendingClockResync = false;
  private lamport = 0;
  private highestLamport = 0;
  private lastCmdPeer = '';
  private lastLocalBufferingState = false;

  private roomState: StateMsg;

  private knownPeers = new Map<
    string,
    { name: string; buffering: boolean; ready: boolean; uid?: string; avatar?: string }
  >();
  private outboundHandler: OutboundHandler | null = null;
  private peerAlive: ((peerId: string) => boolean) | null = null;
  private localActionHandler: LocalActionHandler | null = null;

  private stateBroadcastTimer: ReturnType<typeof setInterval> | null = null;
  private driftCheckTimer: ReturnType<typeof setInterval> | null = null;
  private scheduledStartTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduledStartAt: number | null = null;

  private localPlayerPosition = 0;
  private localPlayerPlaying = false;
  private localPlayerRate = 1.0;
  private localPlayerUrl = '';

  constructor(config: SyncEngineConfig) {
    this.selfId = config.selfId;
    this.awaitingState = config.awaitingState ?? false;
    this.bufferingDelayMs = config.bufferingDelayMs ?? 0;
    this.selfName = config.selfName;
    this.roomCreatorId = config.roomCreatorId ?? (this.awaitingState ? '' : config.selfId);
    this.hostOnlyControls = config.hostOnlyControls ?? false;
    this.nowFn = config.nowFn ?? (() => Date.now());

    this.clock = new RoomClock(this.selfId, this.nowFn);
    if (config.roomCreatorId === this.selfId) this.clock.setPreferredLeader(this.selfId);
    else if (this.awaitingState) this.clock.setDeferToOthers(true);
    this.driftController = new DriftController();

    this.roomState = {
      v: 2,
      type: 'state',
      url: '',
      playing: false,
      position: 0,
      rate: 1.0,
      at: this.nowFn(),
      hold: false,
    };

    this.clock.onLeaderChange((_newLeader, isLeader) => {
      this.handleLeaderChange(isLeader);
    });
  }

  public setOutboundHandler(handler: OutboundHandler): void {
    this.outboundHandler = handler;
  }

  /** Lets the transport veto replacing a peer that still has a live connection (uid spoofing). */
  public setPeerAliveCheck(check: (peerId: string) => boolean): void {
    this.peerAlive = check;
  }

  public setLocalActionHandler(handler: LocalActionHandler): void {
    this.localActionHandler = handler;
  }

  public start(): void {
    this.stop();
    this.clockTimer = setInterval(() => {
      if (!this.clock.isLeader())
        this.emitOutbound(this.clock.createPing(), this.clock.getLeaderId());
    }, 2000);
    // Periodic state broadcast if leader
    this.stateBroadcastTimer = setInterval(() => {
      if (this.clock.isLeader()) {
        this.broadcastState();
      }
    }, STATE_BROADCAST_INTERVAL_MS);

    // Periodic drift control tick (500 ms)
    this.driftCheckTimer = setInterval(() => {
      this.tickDrift();
    }, 500);
  }

  public stop(): void {
    this.clearCreatorTimer();
    if (this.bufferDebounce) clearTimeout(this.bufferDebounce);
    this.bufferDebounce = null;
    if (this.clockTimer) clearInterval(this.clockTimer);
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.clockTimer = null;
    this.holdTimer = null;
    this.scheduledStartAt = null;
    if (this.stateBroadcastTimer) {
      clearInterval(this.stateBroadcastTimer);
      this.stateBroadcastTimer = null;
    }
    if (this.driftCheckTimer) {
      clearInterval(this.driftCheckTimer);
      this.driftCheckTimer = null;
    }
    if (this.scheduledStartTimer) {
      clearTimeout(this.scheduledStartTimer);
      this.scheduledStartTimer = null;
    }
  }

  public getRoomState(): StateMsg {
    return { ...this.roomState };
  }

  public getLamport(): number {
    return this.lamport;
  }

  public getPeers(): Array<{
    peerId: string;
    name: string;
    buffering: boolean;
    ready: boolean;
    uid?: string;
    avatar?: string;
  }> {
    return Array.from(this.knownPeers.entries()).map(([peerId, p]) => ({
      peerId,
      ...p,
    }));
  }

  public setRoomCreator(creatorId: string): void {
    this.roomCreatorId = creatorId;
  }

  public isHoldActive(): boolean {
    return this.roomState.hold;
  }

  private handleLeaderChange(isLeader: boolean): void {
    if (isLeader) {
      // Refresh state snapshot timestamp and broadcast immediately
      this.roomState.at = this.clock.roomTime();
      this.broadcastState();
    }
  }

  private emitOutbound(msg: ProtocolMsg, targetPeerId?: string): void {
    if (this.outboundHandler) {
      this.outboundHandler(msg, targetPeerId);
    }
  }

  private emitLocalAction(action: {
    type: 'play' | 'pause' | 'seek' | 'rate' | 'nav';
    position?: number;
    rate?: number;
    url?: string;
    startAt?: number;
  }): void {
    if (this.localActionHandler) {
      this.localActionHandler(action);
    }
  }

  /**
   * Broadcast current state (called by leader)
   */
  public broadcastState(targetPeerId?: string): void {
    if (this.awaitingState) return;
    const roomNow = this.clock.roomTime();
    if (
      this.clock.isLeader() &&
      this.localPlayerReady &&
      !this.localAdPlaying &&
      this.scheduledStartAt === null &&
      !this.roomState.hold
    ) {
      this.roomState.position = this.measuredPosition();
      this.roomState.at = roomNow;
    }
    // Update position snapshot if playing
    if (this.roomState.playing && !this.roomState.hold) {
      const elapsedSec = Math.max(0, (roomNow - this.roomState.at) / 1000);
      this.roomState.position += elapsedSec * this.roomState.rate;
    }
    this.roomState.at = roomNow;

    const snapshot: StateMsg = {
      v: 2,
      type: 'state',
      url: this.roomState.url,
      playing: this.roomState.playing,
      position: Number(this.roomState.position.toFixed(3)),
      rate: this.roomState.rate,
      at: roomNow,
      hold: this.roomState.hold,
      holdBy: this.roomState.holdBy,
      ownerId: this.roomCreatorId,
      hostOnlyControls: this.hostOnlyControls,
      lamport: this.highestLamport,
      lastCmdPeer: this.lastCmdPeer,
    };

    this.emitOutbound(snapshot, targetPeerId);
  }

  /**
   * Local player reports state event
   */
  public handleLocalPlayerEvent(event: PlayerStateEvent): void {
    this.localAdPlaying = event.adPlaying;
    if (event.adPlaying) return;
    this.localPlayerAt = this.nowFn();
    this.localPlayerReady = event.duration > 0;
    this.localPlayerPosition = event.position;
    this.localPlayerPlaying = event.playing;
    this.localPlayerRate = event.rate;
    this.localPlayerUrl = event.url;

    // Buffering barrier update: only trigger when buffering status changes!
    if (event.buffering !== this.lastLocalBufferingState) {
      this.lastLocalBufferingState = event.buffering;
      this.handleLocalBuffering(event.buffering);
    }

    // Feedback-loop guard: ONLY user-originated events become commands!
    if (event.origin !== 'user') {
      return;
    }

    // Check host-only permission
    if (this.hostOnlyControls && this.selfId !== this.roomCreatorId) {
      return;
    }

    // Advance local Lamport clock
    this.lamport += 1;

    // Detect action
    if (event.url && event.url !== this.roomState.url) {
      this.sendLocalCmd('nav', undefined, undefined, event.url);
    } else if (event.playing !== this.roomState.playing) {
      if (event.playing) {
        this.sendLocalCmd('play', event.position, event.rate);
      } else {
        this.sendLocalCmd('pause', event.position, event.rate);
      }
    } else if (Math.abs(event.position - this.roomState.position) > 1.5) {
      this.sendLocalCmd('seek', event.position, event.rate);
    } else if (event.rate !== this.roomState.rate) {
      this.sendLocalCmd('rate', event.position, event.rate);
    }
  }

  public command(action: CommandAction, position?: number, rate?: number, url?: string): void {
    if (this.hostOnlyControls && this.selfId !== this.roomCreatorId) return;
    this.lamport += 1;
    this.sendLocalCmd(action, position, rate, url);
  }

  public handover(peerId: string): void {
    if (this.selfId !== this.roomCreatorId || !this.knownPeers.has(peerId)) return;
    this.emitOutbound({
      v: 2,
      type: 'control',
      ownerId: peerId,
      hostOnlyControls: this.hostOnlyControls,
    });
    this.roomCreatorId = peerId;
  }

  private sendLocalCmd(
    action: CommandAction,
    position?: number,
    rate?: number,
    url?: string,
  ): void {
    const roomNow = this.clock.roomTime();
    let startAt: number | undefined;

    if (action === 'play') {
      startAt = roomNow + SCHEDULED_START_OFFSET_MS;
    }

    const cmd: CmdMsg = {
      v: 2,
      type: 'cmd',
      lamport: this.lamport,
      from: this.selfId,
      action,
      position: position !== undefined ? Number(position.toFixed(3)) : undefined,
      rate: rate ?? this.roomState.rate,
      url,
      startAt,
    };

    this.highestLamport = cmd.lamport;
    this.lastCmdPeer = this.selfId;
    // Apply locally first
    this.applyCommand(cmd);

    // Broadcast to room
    this.emitOutbound(cmd);
  }

  /**
   * Process incoming validated protocol message from a peer
   */
  public handleRemoteMessage(msg: ProtocolMsg, fromPeerId: string): void {
    switch (msg.type) {
      case 'control': {
        if (fromPeerId === this.roomCreatorId) {
          this.roomCreatorId = msg.ownerId;
          this.hostOnlyControls = msg.hostOnlyControls;
        }
        break;
      }
      case 'hello': {
        this.handlePeerHello(msg, fromPeerId);
        break;
      }

      case 'clock.ping': {
        if (this.clock.isLeader()) {
          const pong = this.clock.handlePing(msg);
          this.emitOutbound(pong, fromPeerId);
        }
        break;
      }

      case 'clock.pong': {
        if (fromPeerId === this.clock.getLeaderId()) this.clock.handlePong(msg);
        break;
      }

      case 'cmd': {
        this.handleRemoteCmd(msg, fromPeerId);
        break;
      }

      case 'state': {
        // A newcomer only trusts a snapshot that the room owner itself sent.
        if (this.awaitingState && msg.ownerId !== fromPeerId) break;
        this.clock.peerJoined(fromPeerId);
        if (this.awaitingState) this.clock.setPreferredLeader(fromPeerId);
        if (this.awaitingState || fromPeerId === this.clock.getLeaderId())
          this.handleRemoteState(msg);
        break;
      }

      case 'buffering': {
        this.handleRemoteBuffering(msg, fromPeerId);
        break;
      }

      case 'ready': {
        this.handleRemoteReady(fromPeerId);
        break;
      }

      case 'bye': {
        this.handlePeerLeft(fromPeerId);
        break;
      }
    }
  }

  private handlePeerHello(msg: HelloMsg, fromPeerId: string): void {
    // Profile refresh from an already-known peer (new name/avatar): update in place.
    const known = this.knownPeers.get(fromPeerId);
    if (known) {
      this.knownPeers.set(fromPeerId, { ...known, name: msg.name, avatar: msg.avatar });
      return;
    }
    // Check room capacity (max 8)
    if (this.knownPeers.size >= MAX_PEERS_PER_ROOM - 1 && !this.knownPeers.has(fromPeerId)) {
      this.emitOutbound(
        {
          v: 2,
          type: 'error',
          code: 'ROOM_FULL',
          message: 'Room is full (maximum 8 participants)',
        },
        fromPeerId,
      );
      return;
    }

    // The same device re-joining (new session id) replaces its stale ghost entry.
    let creatorRejoined = fromPeerId === this.roomCreatorId;
    if (msg.uid)
      for (const [id, p] of this.knownPeers)
        if (id !== fromPeerId && p.uid === msg.uid && !this.peerAlive?.(id)) {
          if (id === this.roomCreatorId) creatorRejoined = true;
          this.handlePeerLeft(id, true);
        }
    if (creatorRejoined) {
      // the host came back (maybe under a new session id): it keeps control
      this.roomCreatorId = fromPeerId;
      this.clearCreatorTimer();
    }
    this.knownPeers.set(fromPeerId, {
      name: msg.name,
      buffering: false,
      ready: true,
      uid: msg.uid,
      avatar: msg.avatar,
    });

    this.clock.peerJoined(fromPeerId);
    if (!this.clock.isLeader()) {
      for (let i = 0; i < 5; i++)
        this.emitOutbound(this.clock.createPing(), this.clock.getLeaderId());
    }

    // If clock leader: immediately send state snapshot to new joiner
    if (!this.awaitingState && this.clock.isLeader()) {
      this.broadcastState(fromPeerId);
    }
  }

  private creatorTimer: ReturnType<typeof setTimeout> | null = null;

  private clearCreatorTimer(): void {
    if (this.creatorTimer) clearTimeout(this.creatorTimer);
    this.creatorTimer = null;
  }

  public handlePeerLeft(peerId: string, replaced = false): void {
    this.knownPeers.delete(peerId);
    const wasLeader = this.clock.getLeaderId() === peerId;
    this.clock.peerLeft(peerId);
    if (wasLeader) this.clock.setPreferredLeader(this.clock.getLeaderId());
    // A dropped connection must not hand control to a viewer: keep the host for a
    // grace period and only promote the clock leader if it really stays away.
    if (this.roomCreatorId === peerId && !replaced && !this.creatorTimer) {
      this.creatorTimer = setTimeout(() => {
        this.creatorTimer = null;
        if (!this.knownPeers.has(this.roomCreatorId) && this.roomCreatorId !== this.selfId)
          this.roomCreatorId = this.clock.getLeaderId();
      }, CREATOR_GRACE_MS);
    }

    // If someone was holding buffering and left, check if remaining are all ready
    if (this.roomState.hold && this.roomState.holdBy === peerId) {
      this.checkBufferingResume();
    }
  }

  private handleRemoteCmd(cmd: CmdMsg, fromPeerId: string): void {
    if (cmd.from !== fromPeerId) return;
    // Host-only controls check
    if (this.hostOnlyControls && fromPeerId !== this.roomCreatorId) {
      return; // Reject commands from non-host peers
    }

    // Command ordering: (lamport, peerId). Stale commands dropped.
    if (
      cmd.lamport < this.highestLamport ||
      (cmd.lamport === this.highestLamport && cmd.from <= this.lastCmdPeer)
    ) {
      return; // Drop stale command
    }

    this.highestLamport = cmd.lamport;
    this.lastCmdPeer = cmd.from;
    this.lamport = Math.max(this.lamport, cmd.lamport);

    this.applyCommand(cmd);
  }

  private applyCommand(cmd: CmdMsg): void {
    const roomNow = this.clock.roomTime();

    switch (cmd.action) {
      case 'play': {
        this.roomState.playing = true;
        this.roomState.at = cmd.startAt ?? roomNow;
        if (cmd.position !== undefined) {
          this.roomState.position = cmd.position;
        }
        if (cmd.rate !== undefined) {
          this.roomState.rate = cmd.rate;
          this.driftController.setBaseRate(cmd.rate);
        }

        // Scheduled start
        if (cmd.startAt && cmd.startAt > roomNow) {
          this.scheduledStartAt = cmd.startAt;
          const delayMs = Math.max(0, cmd.startAt - roomNow);
          if (this.scheduledStartTimer) clearTimeout(this.scheduledStartTimer);
          this.scheduledStartTimer = setTimeout(() => {
            this.scheduledStartAt = null;
            this.emitLocalAction({
              type: 'play',
              position: this.roomState.position,
              rate: this.roomState.rate,
            });
          }, delayMs);
        } else {
          this.scheduledStartAt = null;
          this.emitLocalAction({
            type: 'play',
            position: this.roomState.position,
            rate: this.roomState.rate,
          });
        }
        break;
      }

      case 'pause': {
        if (this.holdTimer) clearTimeout(this.holdTimer);
        if (this.bufferDebounce) clearTimeout(this.bufferDebounce);
        this.holdTimer = null;
        this.bufferDebounce = null;
        this.roomState.hold = false;
        this.roomState.holdBy = undefined;
        this.scheduledStartAt = null;
        this.roomState.playing = false;
        this.roomState.at = roomNow;
        if (cmd.position !== undefined) {
          this.roomState.position = cmd.position;
        }
        if (this.scheduledStartTimer) {
          clearTimeout(this.scheduledStartTimer);
          this.scheduledStartTimer = null;
        }
        this.emitLocalAction({
          type: 'pause',
          position: this.roomState.position,
        });
        break;
      }

      case 'seek': {
        if (cmd.position !== undefined) {
          this.roomState.position = cmd.position;
          this.roomState.at = roomNow;
          // The player has not reported the new position yet: without this a seek-induced
          // buffering hold would snap the room (and the host) back to the stale position.
          this.localPlayerPosition = cmd.position;
          this.localPlayerAt = this.nowFn();
          this.lastSeekAt = this.nowFn();
          this.emitLocalAction({
            type: 'seek',
            position: cmd.position,
          });
        }
        break;
      }

      case 'rate': {
        if (cmd.rate !== undefined) {
          this.roomState.rate = cmd.rate;
          this.driftController.setBaseRate(cmd.rate);
          this.emitLocalAction({
            type: 'rate',
            rate: cmd.rate,
          });
        }
        break;
      }

      case 'nav': {
        if (this.holdTimer) clearTimeout(this.holdTimer);
        if (this.bufferDebounce) clearTimeout(this.bufferDebounce);
        this.holdTimer = null;
        this.bufferDebounce = null;
        this.roomState.hold = false;
        this.roomState.holdBy = undefined;
        this.localPlayerReady = false;
        this.lastLocalBufferingState = false;
        this.scheduledStartAt = null;
        if (this.scheduledStartTimer) clearTimeout(this.scheduledStartTimer);
        if (cmd.url) {
          this.roomState.url = cmd.url;
          this.roomState.position = 0;
          this.roomState.playing = false;
          this.roomState.at = roomNow;
          this.emitLocalAction({
            type: 'nav',
            url: cmd.url,
          });
        }
        break;
      }
    }
  }

  private handleRemoteState(state: StateMsg): void {
    // Only accept state snapshots from the clock leader
    if (this.clock.isLeader() && !this.awaitingState) return;
    if ((state.lamport ?? 0) < this.highestLamport) return;
    if ((state.lamport ?? 0) > this.highestLamport + MAX_LAMPORT_JUMP) return;
    if (this.awaitingState) this.pendingClockResync = true;
    this.awaitingState = false;
    this.highestLamport = state.lamport ?? this.highestLamport;
    this.lamport = Math.max(this.lamport, this.highestLamport);
    this.lastCmdPeer = state.lastCmdPeer ?? this.lastCmdPeer;
    if (state.ownerId) this.roomCreatorId = state.ownerId;
    if (state.hostOnlyControls !== undefined) this.hostOnlyControls = state.hostOnlyControls;
    this.roomState = { ...state };
    this.driftController.setBaseRate(state.rate);

    // Late join URL check
    if (state.url && state.url !== this.localPlayerUrl) {
      this.emitLocalAction({ type: 'nav', url: state.url });
    }

    // Alignment
    const roomNow = this.clock.roomTime();
    const desiredPos = this.driftController.calculateDesiredPosition(state, roomNow);
    // First state of a newcomer aligns tightly; afterwards tolerate drift to avoid seek stutter.
    const seekThreshold = this.pendingClockResync ? 1.5 : DRIFT_NUDGE_MAX_SEC;
    if (
      !this.lastLocalBufferingState &&
      Math.abs(this.measuredPosition() - desiredPos) > seekThreshold
    ) {
      this.emitLocalAction({ type: 'seek', position: desiredPos });
    }

    if (state.playing && !state.hold && !this.localPlayerPlaying) {
      this.emitLocalAction({ type: 'play', position: desiredPos, rate: state.rate });
    } else if ((!state.playing || state.hold) && this.localPlayerPlaying) {
      this.emitLocalAction({ type: 'pause', position: state.position });
    }
  }

  /**
   * Re-apply the current room state to the local player. Called when the local player
   * becomes ready after a navigation (late join) or once the clock has converged.
   */
  public resync(): void {
    if (this.awaitingState || this.clock.isLeader() || this.localAdPlaying) return;
    const state = this.roomState;
    const desired = this.driftController.calculateDesiredPosition(state, this.clock.roomTime());
    if (Math.abs(this.measuredPosition() - desired) > 0.4)
      this.emitLocalAction({ type: 'seek', position: desired });
    if (state.rate !== this.localPlayerRate)
      this.emitLocalAction({ type: 'rate', rate: state.rate });
    if (state.playing && !state.hold) {
      if (!this.localPlayerPlaying)
        this.emitLocalAction({ type: 'play', position: desired, rate: state.rate });
    } else if (this.localPlayerPlaying) {
      this.emitLocalAction({ type: 'pause', position: state.position });
    }
  }

  private handleLocalBuffering(isBuffering: boolean): void {
    const peer = this.knownPeers.get(this.selfId);
    if (peer) {
      peer.buffering = isBuffering;
      peer.ready = !isBuffering;
    }

    this.emitOutbound({
      v: 2,
      type: 'buffering',
      peerId: this.selfId,
      on: isBuffering,
    });

    if (isBuffering && this.clock.isLeader()) {
      this.requestBufferingHold(this.selfId);
    } else if (!isBuffering && this.clock.isLeader()) {
      this.checkBufferingResume();
    }
  }

  private handleRemoteBuffering(msg: BufferingMsg, fromPeerId: string): void {
    let peer = this.knownPeers.get(fromPeerId);
    if (!peer) {
      peer = { name: fromPeerId, buffering: msg.on, ready: !msg.on };
      this.knownPeers.set(fromPeerId, peer);
    } else {
      peer.buffering = msg.on;
      peer.ready = !msg.on;
    }

    if (msg.on && this.clock.isLeader()) {
      this.requestBufferingHold(fromPeerId);
    } else if (!msg.on && this.clock.isLeader()) {
      this.checkBufferingResume();
    }
  }

  private handleRemoteReady(fromPeerId: string): void {
    const peer = this.knownPeers.get(fromPeerId);
    if (peer) {
      peer.buffering = false;
      peer.ready = true;
    }
    if (this.clock.isLeader()) {
      this.checkBufferingResume();
    }
  }

  private requestBufferingHold(peerId: string): void {
    // Buffering caused by the leader's own seek is expected: don't freeze the leader for it.
    if (peerId === this.selfId && this.nowFn() - this.lastSeekAt < 2500) return;
    if (
      this.roomState.hold ||
      this.bufferDebounce ||
      !this.roomState.playing ||
      this.nowFn() < this.barrierCooldownUntil
    )
      return;
    if (!this.bufferingDelayMs) {
      this.leaderHoldBuffering(peerId);
      return;
    }
    this.bufferDebounce = setTimeout(() => {
      this.bufferDebounce = null;
      const stillBuffering =
        peerId === this.selfId
          ? this.lastLocalBufferingState
          : this.knownPeers.get(peerId)?.buffering;
      if (stillBuffering) this.leaderHoldBuffering(peerId);
    }, this.bufferingDelayMs);
  }

  private measuredPosition(): number {
    return (
      this.localPlayerPosition +
      (this.localPlayerPlaying && !this.lastLocalBufferingState
        ? (Math.max(0, this.nowFn() - this.localPlayerAt) / 1000) * this.localPlayerRate
        : 0)
    );
  }

  private leaderHoldBuffering(bufferPeerId: string): void {
    if (this.roomState.hold) return; // already held

    if (!this.roomState.playing || this.localAdPlaying) return;
    this.holdTimer = setTimeout(() => this.checkBufferingResume(true), 5000);
    this.roomState.hold = true;
    this.roomState.holdBy = bufferPeerId;
    this.roomState.position = this.measuredPosition();
    this.roomState.at = this.clock.roomTime();

    // Broadcast hold state
    this.broadcastState();
    this.emitLocalAction({ type: 'pause', position: this.roomState.position });
  }

  private checkBufferingResume(force = false): void {
    if (!this.roomState.hold) return;

    if (!force && this.lastLocalBufferingState) return;
    // Check if any peer is still buffering
    for (const [, peer] of this.knownPeers) {
      if (peer.buffering && !force) {
        return; // still someone buffering
      }
    }

    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.barrierCooldownUntil = this.nowFn() + 3000;
    // All peers are ready! Resume playback simultaneously with startAt
    this.roomState.hold = false;
    this.roomState.holdBy = undefined;
    const roomNow = this.clock.roomTime();
    const startAt = roomNow + SCHEDULED_START_OFFSET_MS;
    this.roomState.at = startAt;

    this.lamport += 1;
    this.sendLocalCmd('play', this.roomState.position, this.roomState.rate);
  }

  /**
   * Periodic drift check tick (every 500 ms)
   */
  public tickDrift(): DriftCorrection {
    const roomNow = this.clock.roomTime();

    // Check if scheduled start is due
    if (this.scheduledStartAt !== null && roomNow >= this.scheduledStartAt) {
      this.scheduledStartAt = null;
      if (this.scheduledStartTimer) {
        clearTimeout(this.scheduledStartTimer);
        this.scheduledStartTimer = null;
      }
      this.emitLocalAction({
        type: 'play',
        position: this.roomState.position,
        rate: this.roomState.rate,
      });
    }

    if (this.pendingClockResync && this.clock.getRttStats().samplesCount >= 3) {
      this.pendingClockResync = false;
      this.resync();
    }

    if (this.localAdPlaying || !this.localPlayerPlaying || this.roomState.hold) {
      return { type: 'none', rate: 1.0 };
    }

    if (this.lastLocalBufferingState || this.clock.isLeader())
      return { type: 'none', rate: this.roomState.rate };
    const correction = this.driftController.evaluateDrift(
      this.measuredPosition(),
      this.roomState,
      roomNow,
    );

    if (correction.type === 'nudge') {
      this.emitLocalAction({ type: 'rate', rate: correction.rate });
    } else if (correction.type === 'seek') {
      this.emitLocalAction({ type: 'seek', position: correction.position });
    } else if (correction.type === 'none') {
      // Reset rate back to baseRate (1.0) when in deadband
      if (Math.abs(this.localPlayerRate - correction.rate) > 0.001) {
        this.emitLocalAction({ type: 'rate', rate: correction.rate });
      }
    }

    return correction;
  }
}
