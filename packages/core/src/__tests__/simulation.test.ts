import { describe, expect, it } from 'vitest';
import { SyncEngine } from '../sync-engine.js';
import type { ProtocolMsg } from '../types.js';

interface SimulatedPacket {
  deliveryTime: number;
  from: string;
  to: string;
  msg: ProtocolMsg;
}

interface SimulatedPeer {
  id: string;
  engine: SyncEngine;
  localPos: number;
  playing: boolean;
  rate: number;
  clockDriftRate: number; // slight hardware clock skew (+-0.05%)
}

describe('Long Simulated Session (5-minute, 150ms RTT, 30ms Jitter)', () => {
  it('keeps p95 drift < 3000ms (deadband) over 300 simulated seconds', () => {
    let simTime = 1000000;
    const packetQueue: SimulatedPacket[] = [];

    const peerIds = ['peer_0', 'peer_1', 'peer_2', 'peer_3']; // peer_0 is leader
    const peers: SimulatedPeer[] = peerIds.map((id, index) => {
      const engine = new SyncEngine({
        selfId: id,
        selfName: `User ${index}`,
        nowFn: () => simTime,
      });
      // Add a tiny real-world playback speed skew per peer (+-0.05%)
      const clockDriftRate = 1.0 + (index - 1.5) * 0.0005;
      return {
        id,
        engine,
        localPos: 0,
        playing: false, // All peers start playing at startAt
        rate: 1.0,
        clockDriftRate,
      };
    });

    // Wire up simulated network
    const RTT_BASE_MS = 150;
    const JITTER_MS = 30;

    for (const peer of peers) {
      peer.engine.setOutboundHandler((msg, targetPeerId) => {
        const recipients = targetPeerId
          ? [peers.find((p) => p.id === targetPeerId)!]
          : peers.filter((p) => p.id !== peer.id);

        for (const r of recipients) {
          if (!r) continue;
          // RTT / 2 + jitter
          const latency = RTT_BASE_MS / 2 + (Math.random() * 2 - 1) * JITTER_MS;
          packetQueue.push({
            deliveryTime: simTime + latency,
            from: peer.id,
            to: r.id,
            msg,
          });
        }
      });

      peer.engine.setLocalActionHandler((action) => {
        if (action.type === 'play') {
          peer.playing = true;
          if (action.position !== undefined) peer.localPos = action.position;
          if (action.rate !== undefined) peer.rate = action.rate;
        } else if (action.type === 'pause') {
          peer.playing = false;
          if (action.position !== undefined) peer.localPos = action.position;
        } else if (action.type === 'seek' && action.position !== undefined) {
          peer.localPos = action.position;
        } else if (action.type === 'rate' && action.rate !== undefined) {
          peer.rate = action.rate;
        }
      });
    }

    // Connect peers in room
    for (let i = 1; i < peers.length; i++) {
      const p = peers[i]!;
      const p0 = peers[0]!;
      p0.engine.handleRemoteMessage({ v: 2, type: 'hello', peerId: p.id, name: `User ${i}` }, p.id);
      p.engine.handleRemoteMessage({ v: 2, type: 'hello', peerId: p0.id, name: 'User 0' }, p0.id);
    }

    // 1. Set initial room URL from leader
    peers[0]!.engine.handleLocalPlayerEvent({
      playing: false,
      position: 0,
      rate: 1.0,
      duration: 3600,
      buffering: false,
      adPlaying: false,
      url: 'https://youtube.com/watch?v=simulation',
      origin: 'user',
    });

    // 2. Start playback from leader
    peers[0]!.engine.handleLocalPlayerEvent({
      playing: true,
      position: 0,
      rate: 1.0,
      duration: 3600,
      buffering: false,
      adPlaying: false,
      url: 'https://youtube.com/watch?v=simulation',
      origin: 'user',
    });

    const driftMeasurementsMs: number[] = [];
    const TOTAL_SECONDS = 300; // 5 minutes
    const TICK_INTERVAL_MS = 100; // 100ms simulation resolution
    const totalTicks = (TOTAL_SECONDS * 1000) / TICK_INTERVAL_MS;

    for (let tick = 0; tick < totalTicks; tick++) {
      simTime += TICK_INTERVAL_MS;

      // 1. Deliver pending network packets
      const readyPackets: SimulatedPacket[] = [];
      const remainingPackets: SimulatedPacket[] = [];
      for (const pkt of packetQueue) {
        if (pkt.deliveryTime <= simTime) {
          readyPackets.push(pkt);
        } else {
          remainingPackets.push(pkt);
        }
      }
      packetQueue.length = 0;
      packetQueue.push(...remainingPackets);

      for (const pkt of readyPackets) {
        const receiver = peers.find((p) => p.id === pkt.to);
        if (receiver) {
          receiver.engine.handleRemoteMessage(pkt.msg, pkt.from);
        }
      }

      // 2. Periodic pings every 2s
      if (tick % 20 === 0) {
        for (let i = 1; i < peers.length; i++) {
          const peer = peers[i]!;
          const leader = peers[0]!;
          const ping = peer.engine.clock.createPing(simTime);
          const latency = RTT_BASE_MS / 2 + (Math.random() * 2 - 1) * JITTER_MS;
          packetQueue.push({
            deliveryTime: simTime + latency,
            from: peer.id,
            to: leader.id,
            msg: ping,
          });
        }
      }

      // 3. Leader periodic state broadcast every 2s
      if (tick % 20 === 0) {
        peers[0]!.engine.broadcastState();
      }

      // 4. Update simulated video position & tick drift controller every 500ms
      const is500msTick = tick % 5 === 0;

      for (const peer of peers) {
        if (peer.playing) {
          // Progress playback with clock drift skew
          peer.localPos += (TICK_INTERVAL_MS / 1000) * peer.rate * peer.clockDriftRate;
        }

        if (is500msTick) {
          // Feed current local state to sync engine
          peer.engine.handleLocalPlayerEvent({
            playing: peer.playing,
            position: peer.localPos,
            rate: peer.rate,
            duration: 3600,
            buffering: false,
            adPlaying: false,
            url: 'https://youtube.com/watch?v=simulation',
            origin: 'program',
          });
          peer.engine.tickDrift();
        }
      }

      // 5. Measure drift between leader (peer_0) and all follower peers after initial 10s warmup
      const leader = peers[0]!;
      if (simTime > 1010000 && is500msTick) {
        const leaderPos = leader.localPos;
        for (let i = 1; i < peers.length; i++) {
          const follower = peers[i]!;
          const driftMs = Math.abs(follower.localPos - leaderPos) * 1000;
          driftMeasurementsMs.push(driftMs);
        }
      }
    }

    // Compute percentiles
    driftMeasurementsMs.sort((a, b) => a - b);
    const count = driftMeasurementsMs.length;
    expect(count).toBeGreaterThan(500);

    const p50 = driftMeasurementsMs[Math.floor(count * 0.5)]!;
    const p90 = driftMeasurementsMs[Math.floor(count * 0.9)]!;
    const p95 = driftMeasurementsMs[Math.floor(count * 0.95)]!;
    const p99 = driftMeasurementsMs[Math.floor(count * 0.99)]!;
    const max = driftMeasurementsMs[count - 1]!;

    console.log('=== Final Peer Statuses ===');
    console.log(
      peers.map((p) => ({ id: p.id, pos: p.localPos, playing: p.playing, rate: p.rate })),
    );
    console.log('=== 5-Minute Simulation Drift Results ===');
    console.log(`Total samples: ${count}`);
    console.log(`p50 drift:     ${p50.toFixed(2)} ms`);
    console.log(`p90 drift:     ${p90.toFixed(2)} ms`);
    console.log(`p95 drift:     ${p95.toFixed(2)} ms`);
    console.log(`p99 drift:     ${p99.toFixed(2)} ms`);
    console.log(`Max drift:     ${max.toFixed(2)} ms`);
    console.log('========================================');

    // Hard gate assertion: drift stays inside the tolerance window (no hard seeks)
    expect(p95).toBeLessThan(3000);
  });
});
