import { describe, expect, it } from 'vitest';
import { RoomClock } from '../clock.js';

describe('RoomClock', () => {
  it('elects lowest lexicographical peerId as clock leader', () => {
    const clock = new RoomClock('user_b');
    expect(clock.isLeader()).toBe(true);

    // user_a joins -> user_a is lower -> user_a becomes leader
    clock.peerJoined('user_a');
    expect(clock.getLeaderId()).toBe('user_a');
    expect(clock.isLeader()).toBe(false);

    // user_c joins -> user_a is still lowest
    clock.peerJoined('user_c');
    expect(clock.getLeaderId()).toBe('user_a');

    // user_a leaves -> user_b is next lowest -> user_b becomes leader
    clock.peerLeft('user_a');
    expect(clock.getLeaderId()).toBe('user_b');
    expect(clock.isLeader()).toBe(true);
  });

  it('correctly estimates offset and RTT from ping/pong exchanges', () => {
    const followerClock = new RoomClock('peer_b');
    const leaderClock = new RoomClock('peer_a');
    followerClock.peerJoined('peer_a');

    // Leader clock is 5000ms ahead of follower clock
    const leaderClockOffset = 5000;
    const latency = 50; // 50ms one way -> RTT = 100ms

    for (let i = 0; i < 5; i++) {
      const t0 = 1000 + i * 100;
      const ping = followerClock.createPing(t0);

      const t1 = t0 + latency + leaderClockOffset;
      const pong = leaderClock.handlePing(ping, t1);

      const t3 = t1 + latency - leaderClockOffset; // Arrival at follower
      followerClock.handlePong(pong, t3);
    }

    // Offset should be close to +5000ms
    const estimatedOffset = followerClock.getOffset();
    expect(Math.abs(estimatedOffset - leaderClockOffset)).toBeLessThan(10);

    const followerLocalNow = 2000;
    const roomNow = followerClock.roomTime(followerLocalNow);
    expect(Math.abs(roomNow - (followerLocalNow + leaderClockOffset))).toBeLessThan(10);
  });

  it('supports reset, setPeers, localTime conversions and getters', () => {
    const clock = new RoomClock('user_b');
    expect(clock.getBurstCount()).toBe(5);
    expect(clock.getIntervalMs()).toBe(2000);

    clock.setPeers(['user_a', 'user_c']);
    expect(clock.getLeaderId()).toBe('user_a');

    const localT = 1000;
    const roomT = clock.roomTime(localT);
    expect(clock.localTime(roomT)).toBe(localT);

    clock.reset();
    expect(clock.getLeaderId()).toBe('user_b');
    expect(clock.isLeader()).toBe(true);
    expect(clock.getOffset()).toBe(0);
  });
});
