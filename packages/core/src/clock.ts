import { CLOCK_PING_BURST_COUNT, CLOCK_PING_INTERVAL_MS } from './constants.js';
import type { ClockPingMsg, ClockPongMsg } from './types.js';

export interface ClockSample {
  rtt: number;
  offset: number;
  ts: number;
}

export class RoomClock {
  public readonly selfId: string;
  private nowFn: () => number;
  private connectedPeers = new Set<string>();
  private leaderId: string;
  private samples: ClockSample[] = [];
  private currentOffset = 0;
  private preferredLeader = '';
  private deferToOthers = false;
  private maxSamples = 10;
  private onLeaderChangeCallbacks: Array<(newLeaderId: string, isLeader: boolean) => void> = [];

  constructor(selfId: string, nowFn: () => number = () => Date.now()) {
    this.selfId = selfId;
    this.nowFn = nowFn;
    this.leaderId = selfId; // Initially self until other peers known
  }

  public getLeaderId(): string {
    return this.leaderId;
  }

  public isLeader(): boolean {
    return this.leaderId === this.selfId;
  }

  public getOffset(): number {
    return this.isLeader() ? 0 : this.currentOffset;
  }

  public roomTime(localTime?: number): number {
    const time = localTime ?? this.nowFn();
    return this.isLeader() ? time : time + this.currentOffset;
  }

  public localTime(roomTime: number): number {
    return this.isLeader() ? roomTime : roomTime - this.currentOffset;
  }

  public onLeaderChange(callback: (newLeaderId: string, isLeader: boolean) => void): () => void {
    this.onLeaderChangeCallbacks.push(callback);
    return () => {
      this.onLeaderChangeCallbacks = this.onLeaderChangeCallbacks.filter((cb) => cb !== callback);
    };
  }

  public setPeers(peers: string[]): { leaderChanged: boolean; newLeaderId: string } {
    this.connectedPeers = new Set(peers);
    const oldLeader = this.leaderId;
    this.recomputeLeader();

    const changed = oldLeader !== this.leaderId;
    if (changed) {
      if (this.isLeader()) {
        this.currentOffset = 0;
        this.samples = [];
      }
      this.notifyLeaderChange();
    }
    return { leaderChanged: changed, newLeaderId: this.leaderId };
  }

  /** Pin leadership to an established peer so newcomers (random ids) never steal it. */
  public setPreferredLeader(peerId: string): void {
    this.preferredLeader = peerId;
    this.deferToOthers = false;
    this.refreshLeader();
  }

  /** A newcomer without room state must follow an existing peer rather than lead. */
  public setDeferToOthers(defer: boolean): void {
    this.deferToOthers = defer;
    this.refreshLeader();
  }

  private refreshLeader(): void {
    const oldLeader = this.leaderId;
    this.recomputeLeader();
    if (oldLeader === this.leaderId) return;
    this.samples = [];
    if (this.isLeader()) this.currentOffset = 0;
    this.notifyLeaderChange();
  }

  public peerJoined(peerId: string): { leaderChanged: boolean; newLeaderId: string } {
    this.connectedPeers.add(peerId);
    const oldLeader = this.leaderId;
    this.recomputeLeader();

    const changed = oldLeader !== this.leaderId;
    if (changed) {
      if (this.isLeader()) {
        this.currentOffset = 0;
        this.samples = [];
      }
      this.notifyLeaderChange();
    }
    return { leaderChanged: changed, newLeaderId: this.leaderId };
  }

  public peerLeft(peerId: string): { leaderChanged: boolean; newLeaderId: string } {
    this.connectedPeers.delete(peerId);
    if (this.preferredLeader === peerId) this.preferredLeader = '';
    const oldLeader = this.leaderId;
    this.recomputeLeader();

    const changed = oldLeader !== this.leaderId;
    if (changed) {
      if (this.isLeader()) {
        this.currentOffset = 0;
        this.samples = [];
      } else {
        // Reset samples on leader change to re-estimate
        this.samples = [];
      }
      this.notifyLeaderChange();
    }
    return { leaderChanged: changed, newLeaderId: this.leaderId };
  }

  private recomputeLeader(): void {
    const all = [this.selfId, ...this.connectedPeers];
    all.sort(); // Lexicographical lowest is leader unless pinned
    const others = all.filter((id) => id !== this.selfId);
    if (this.preferredLeader && all.includes(this.preferredLeader))
      this.leaderId = this.preferredLeader;
    else if (this.deferToOthers && others.length) this.leaderId = others[0] as string;
    else this.leaderId = all[0] ?? this.selfId;
  }

  private notifyLeaderChange(): void {
    const isL = this.isLeader();
    for (const cb of this.onLeaderChangeCallbacks) {
      cb(this.leaderId, isL);
    }
  }

  /**
   * Generates a ping message to send to the leader
   */
  public createPing(now?: number): ClockPingMsg {
    return {
      v: 2,
      type: 'clock.ping',
      t0: now ?? this.nowFn(),
    };
  }

  /**
   * Called on the leader when receiving a ping
   */
  public handlePing(ping: ClockPingMsg, now?: number): ClockPongMsg {
    const time = now ?? this.nowFn();
    return {
      v: 2,
      type: 'clock.pong',
      t0: ping.t0,
      t1: time,
      t2: time,
    };
  }

  /**
   * Called on the client when receiving a pong from the leader
   */
  public handlePong(pong: ClockPongMsg, t3?: number): void {
    const arrivalTime = t3 ?? this.nowFn();
    const { t0, t1, t2 } = pong;
    const rtt = Math.max(0, arrivalTime - t0 - (t2 - t1));
    const offset = (t1 - t0 + (t2 - arrivalTime)) / 2;

    this.samples.push({ rtt, offset, ts: arrivalTime });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    this.recalculateOffset();
  }

  /**
   * Calculates median offset from lowest-RTT samples
   */
  private recalculateOffset(): void {
    if (this.samples.length === 0) return;

    // Sort by RTT ascending to keep lowest RTT samples
    const sortedByRtt = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    // Take lowest half
    const halfLen = Math.max(1, Math.ceil(sortedByRtt.length / 2));
    const bestSamples = sortedByRtt.slice(0, halfLen);

    // Median of offsets in best samples
    const offsets = bestSamples.map((s) => s.offset).sort((a, b) => a - b);
    const mid = Math.floor(offsets.length / 2);
    const medianOffset =
      offsets.length % 2 !== 0 ? offsets[mid]! : (offsets[mid - 1]! + offsets[mid]!) / 2;

    // Smooth offset with exponential moving average if we already had an offset
    if (this.samples.length > 2 && Math.abs(this.currentOffset) > 0) {
      this.currentOffset = this.currentOffset * 0.7 + medianOffset * 0.3;
    } else {
      this.currentOffset = medianOffset;
    }
  }

  public getBurstCount(): number {
    return CLOCK_PING_BURST_COUNT;
  }

  public getIntervalMs(): number {
    return CLOCK_PING_INTERVAL_MS;
  }

  public getRttStats(): { samplesCount: number; medianRtt: number; p95Rtt: number } {
    if (this.samples.length === 0) {
      return { samplesCount: 0, medianRtt: 0, p95Rtt: 0 };
    }
    const rtts = this.samples.map((s) => s.rtt).sort((a, b) => a - b);
    const mid = Math.floor(rtts.length / 2);
    const medianRtt = rtts.length % 2 !== 0 ? rtts[mid]! : (rtts[mid - 1]! + rtts[mid]!) / 2;
    const p95Idx = Math.min(rtts.length - 1, Math.floor(rtts.length * 0.95));
    const p95Rtt = rtts[p95Idx]!;
    return { samplesCount: rtts.length, medianRtt, p95Rtt };
  }

  public reset(): void {
    this.samples = [];
    this.currentOffset = 0;
    this.connectedPeers.clear();
    this.leaderId = this.selfId;
  }
}
