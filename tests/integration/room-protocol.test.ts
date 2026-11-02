import { describe, expect, it } from 'vitest';
import { RoomClock } from '../../packages/core/src/clock.js';
import { SyncEngine } from '../../packages/core/src/sync-engine.js';
import type { CmdMsg, ProtocolMsg } from '../../packages/core/src/types.js';

describe('Room Protocol & Synchronization Integration', () => {
  it('late joiner gets link and position < 3s', async () => {
    // 1. Host peer_0 is playing a video at position 120s
    let capturedStateResponse: ProtocolMsg | null = null;

    const hostEngine = new SyncEngine({
      selfId: 'peer_0',
      selfName: 'Host Alice',
      roomCreatorId: 'peer_0',
    });

    hostEngine.setOutboundHandler((msg, targetId) => {
      if (msg.type === 'state' && targetId === 'peer_1') {
        capturedStateResponse = msg;
      }
    });

    // Host navigates to URL and starts playing
    hostEngine.handleLocalPlayerEvent({
      url: 'https://example.com/movie.mp4',
      playing: false,
      position: 0,
      rate: 1.0,
      buffering: false,
      origin: 'user',
    });

    hostEngine.handleLocalPlayerEvent({
      url: 'https://example.com/movie.mp4',
      playing: true,
      position: 120.0,
      rate: 1.0,
      buffering: false,
      origin: 'user',
    });

    const startTime = Date.now();

    // 2. Late joiner peer_1 connects and sends hello message
    let joinerAction: any = null;
    const lateJoinerEngine = new SyncEngine({
      selfId: 'peer_1',
      selfName: 'Bob',
      roomCreatorId: 'peer_0',
    });

    lateJoinerEngine.setLocalActionHandler((action) => {
      joinerAction = action;
    });

    // Late joiner sends 'hello' requesting current state
    hostEngine.handleRemoteMessage(
      {
        type: 'hello',
        v: 2,
        peerId: 'peer_1',
        name: 'Bob',
      },
      'peer_1',
    );

    // Host responds with 'state' snapshot
    expect(capturedStateResponse).not.toBeNull();
    expect(capturedStateResponse?.type).toBe('state');

    // Deliver host state to late joiner
    lateJoinerEngine.handleRemoteMessage(capturedStateResponse!, 'peer_0');

    const elapsedMs = Date.now() - startTime;

    // Verify late joiner received position and time well under 3 seconds
    expect(elapsedMs).toBeLessThan(3000);
    const joinerState = lateJoinerEngine.getRoomState();
    expect(joinerState.url).toBe('https://example.com/movie.mp4');
    expect(joinerState.position).toBeGreaterThanOrEqual(120.0);
    expect(joinerAction).not.toBeNull();
  });

  it('executes leader handover smoothly in integration', async () => {
    let broadcast0: ProtocolMsg | null = null;
    let broadcast1: ProtocolMsg | null = null;

    const engine0 = new SyncEngine({
      selfId: 'peer_0',
      selfName: 'Alice',
      roomCreatorId: 'peer_0',
      hostOnlyControls: true,
    });
    engine0.setOutboundHandler((msg) => {
      broadcast0 = msg;
    });

    const engine1 = new SyncEngine({
      selfId: 'peer_1',
      selfName: 'Bob',
      roomCreatorId: 'peer_0',
      hostOnlyControls: true,
    });
    engine1.setOutboundHandler((msg) => {
      broadcast1 = msg;
    });

    // Host navigates room to video URL
    engine0.handleLocalPlayerEvent({
      url: 'https://example.com/test.mp4',
      playing: false,
      position: 0,
      rate: 1.0,
      buffering: false,
      origin: 'user',
    });
    expect(broadcast0).not.toBeNull();
    expect((broadcast0 as CmdMsg).action).toBe('nav');

    // Deliver nav command from host to peer 1
    engine1.handleRemoteMessage(broadcast0!, 'peer_0');
    expect(engine1.getRoomState().url).toBe('https://example.com/test.mp4');

    broadcast1 = null;

    // Non-host peer_1 tries to trigger a user play command
    engine1.handleLocalPlayerEvent({
      url: 'https://example.com/test.mp4',
      playing: true,
      position: 10.0,
      rate: 1.0,
      buffering: false,
      origin: 'user',
    });
    // Rejected: not host
    expect(broadcast1).toBeNull();

    // Host performs leader handover to peer_1
    engine0.setRoomCreator('peer_1');
    engine1.setRoomCreator('peer_1');

    // Now peer_1 is the host and its play commands are accepted and broadcast
    engine1.handleLocalPlayerEvent({
      url: 'https://example.com/test.mp4',
      playing: true,
      position: 15.0,
      rate: 1.0,
      buffering: false,
      origin: 'user',
    });
    expect(broadcast1).not.toBeNull();
    const cmd = broadcast1 as CmdMsg;
    expect(cmd.type).toBe('cmd');
    expect(cmd.action).toBe('play');
  });

  it('manages buffering hold and resume barriers', async () => {
    let localAction: any = null;
    const engine0 = new SyncEngine({
      selfId: 'peer_0',
      selfName: 'Host',
      roomCreatorId: 'peer_0',
    });
    engine0.setLocalActionHandler((action) => {
      localAction = action;
    });

    // Set URL
    engine0.handleLocalPlayerEvent({
      url: 'https://example.com/test.mp4',
      playing: false,
      position: 0,
      rate: 1.0,
      buffering: false,
      origin: 'user',
    });

    // Start playing
    engine0.handleLocalPlayerEvent({
      url: 'https://example.com/test.mp4',
      playing: true,
      position: 50.0,
      rate: 1.0,
      buffering: false,
      origin: 'user',
    });

    // Remote peer reports buffering: true
    engine0.handleRemoteMessage(
      {
        type: 'buffering',
        v: 2,
        on: true,
      },
      'peer_1',
    );

    // SyncEngine must enter buffering hold (barrier active)
    expect(engine0.isHoldActive()).toBe(true);
    expect(localAction?.type).toBe('pause');

    // Remote peer finishes buffering: false
    engine0.handleRemoteMessage(
      {
        type: 'buffering',
        v: 2,
        on: false,
      },
      'peer_1',
    );

    // Buffering barrier cleared
    expect(engine0.isHoldActive()).toBe(false);

    // Wait for scheduled start delay (250ms) to trigger synchronized play
    await new Promise((r) => setTimeout(r, 300));
    expect(localAction?.type).toBe('play');
  });

  it('handles rate and navigation commands', async () => {
    let lastCmd: any = null;

    const engine0 = new SyncEngine({
      selfId: 'peer_0',
      roomCreatorId: 'peer_0',
    });
    engine0.setOutboundHandler((msg) => {
      lastCmd = msg;
    });

    // Set initial state
    engine0.handleLocalPlayerEvent({
      url: 'https://example.com/movie.mp4',
      playing: false,
      position: 0,
      rate: 1.0,
      buffering: false,
      origin: 'user',
    });

    engine0.handleLocalPlayerEvent({
      url: 'https://example.com/movie.mp4',
      playing: true,
      position: 30.0,
      rate: 1.0,
      buffering: false,
      origin: 'user',
    });

    // Now change rate
    engine0.handleLocalPlayerEvent({
      url: 'https://example.com/movie.mp4',
      playing: true,
      position: 30.0,
      rate: 1.75,
      buffering: false,
      origin: 'user',
    });

    expect(lastCmd).not.toBeNull();
    expect(lastCmd.type).toBe('cmd');
    expect(lastCmd.action).toBe('rate');
    expect(lastCmd.rate).toBe(1.75);

    // Remote rate command received by peer
    let peerAction: any = null;
    const engine1 = new SyncEngine({
      selfId: 'peer_1',
      roomCreatorId: 'peer_0',
    });
    engine1.setLocalActionHandler((a) => {
      peerAction = a;
    });

    engine1.handleRemoteMessage(lastCmd, 'peer_0');
    expect(peerAction?.type).toBe('rate');
    expect(peerAction?.rate).toBe(1.75);
  });

  it('measures p50 and p95 latency accurately from ping/pong samples', () => {
    const clock = new RoomClock('peer_0');

    // 8 samples within window
    const rtts = [45, 48, 50, 52, 55, 58, 60, 65];

    for (let i = 0; i < rtts.length; i++) {
      const rtt = rtts[i];
      const sendTime = 1000 + i * 200;
      const remoteReceiveTime = sendTime + rtt / 2;
      const receiveTime = sendTime + rtt;

      clock.handlePong(
        {
          type: 'clock.pong',
          v: 2,
          t0: sendTime,
          t1: remoteReceiveTime,
          t2: remoteReceiveTime,
        },
        receiveTime,
      );
    }

    const rttStats = clock.getRttStats();
    expect(rttStats).toBeDefined();
    expect(rttStats.samplesCount).toBe(8);
    expect(rttStats.medianRtt).toBeGreaterThan(45);
    expect(rttStats.medianRtt).toBeLessThan(60);
    expect(rttStats.p95Rtt).toBeGreaterThanOrEqual(60);
  });
});
