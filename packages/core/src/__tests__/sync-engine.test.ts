import { describe, expect, it, vi } from 'vitest';
import { SyncEngine } from '../sync-engine.js';
import type { CmdMsg, HelloMsg, PlayerStateEvent, ProtocolMsg, StateMsg } from '../types.js';

describe('SyncEngine', () => {
  it('enforces feedback-loop guard: origin=program is never rebroadcast', () => {
    const engine = new SyncEngine({ selfId: 'user1', selfName: 'Alice' });
    const outboundSpy = vi.fn();
    engine.setOutboundHandler(outboundSpy);

    // Programmatic player state update (e.g. caused by drift adjustment)
    const programEvent: PlayerStateEvent = {
      playing: true,
      position: 12.0,
      rate: 1.0,
      duration: 100,
      buffering: false,
      adPlaying: false,
      url: 'https://youtube.com/watch?v=1',
      origin: 'program',
    };

    engine.handleLocalPlayerEvent(programEvent);
    expect(outboundSpy).not.toHaveBeenCalled();

    // User player state update -> MUST broadcast a command
    const userEvent: PlayerStateEvent = {
      ...programEvent,
      origin: 'user',
      position: 15.0,
    };

    engine.handleLocalPlayerEvent(userEvent);
    expect(outboundSpy).toHaveBeenCalled();
    const call = outboundSpy.mock.calls[0] as [ProtocolMsg, string | undefined];
    const emittedMsg: ProtocolMsg = call[0];
    expect(emittedMsg.type).toBe('cmd');
  });

  it('drops stale commands using Lamport logical clocks', () => {
    const engine = new SyncEngine({ selfId: 'user1', selfName: 'Alice' });
    const localActionSpy = vi.fn();
    engine.setLocalActionHandler(localActionSpy);

    const cmd1: CmdMsg = {
      v: 2,
      type: 'cmd',
      lamport: 5,
      from: 'peer2',
      action: 'seek',
      position: 30.0,
    };

    engine.handleRemoteMessage(cmd1, 'peer2');
    expect(localActionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'seek', position: 30.0 }),
    );
    expect(engine.getLamport()).toBe(5);

    // Stale command with lamport=4 must be dropped
    const staleCmd: CmdMsg = {
      v: 2,
      type: 'cmd',
      lamport: 4,
      from: 'peer3',
      action: 'seek',
      position: 10.0,
    };

    localActionSpy.mockClear();
    engine.handleRemoteMessage(staleCmd, 'peer3');
    expect(localActionSpy).not.toHaveBeenCalled();
  });

  it('enforces host-only controls when enabled by room creator', () => {
    const engine = new SyncEngine({
      selfId: 'viewer1',
      selfName: 'Bob',
      roomCreatorId: 'host1',
      hostOnlyControls: true,
    });
    const localActionSpy = vi.fn();
    engine.setLocalActionHandler(localActionSpy);

    // Non-host tries to pause
    const rogueCmd: CmdMsg = {
      v: 2,
      type: 'cmd',
      lamport: 2,
      from: 'viewer2',
      action: 'pause',
    };

    engine.handleRemoteMessage(rogueCmd, 'viewer2');
    expect(localActionSpy).not.toHaveBeenCalled();

    // Host commands ARE accepted
    const hostCmd: CmdMsg = {
      v: 2,
      type: 'cmd',
      lamport: 3,
      from: 'host1',
      action: 'pause',
    };

    engine.handleRemoteMessage(hostCmd, 'host1');
    expect(localActionSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'pause' }));
  });

  it('buffering barrier: leader pauses room on peer buffering and resumes on ready', () => {
    const leader = new SyncEngine({ selfId: 'a_leader', selfName: 'Alice' });
    const outboundSpy = vi.fn();
    leader.setOutboundHandler(outboundSpy);

    // Join peer
    leader.handleRemoteMessage({ v: 2, type: 'hello', peerId: 'b_peer', name: 'Bob' }, 'b_peer');

    leader.command('play', 0, 1);
    // Bob starts buffering
    leader.command('play', 0, 1);
    leader.handleRemoteMessage({ v: 2, type: 'buffering', peerId: 'b_peer', on: true }, 'b_peer');

    // Leader state must be hold=true
    expect(leader.getRoomState().hold).toBe(true);
    expect(leader.getRoomState().holdBy).toBe('b_peer');

    // Bob finishes buffering -> sends ready
    leader.handleRemoteMessage({ v: 2, type: 'ready', peerId: 'b_peer' }, 'b_peer');

    // Leader hold must clear
    expect(leader.getRoomState().hold).toBe(false);
  });

  it('rejects 9th peer when room reaches max 8 peers', () => {
    const host = new SyncEngine({ selfId: 'peer_0', selfName: 'Host' });
    const outboundSpy = vi.fn();
    host.setOutboundHandler(outboundSpy);

    // Add 7 peers (total 8 with host)
    for (let i = 1; i <= 7; i++) {
      const hello: HelloMsg = { v: 2, type: 'hello', peerId: `peer_${i}`, name: `User ${i}` };
      host.handleRemoteMessage(hello, `peer_${i}`);
    }

    // 8th peer attempts to join (9th total)
    const overflowPeer: HelloMsg = {
      v: 2,
      type: 'hello',
      peerId: 'peer_8',
      name: 'User 8',
    };
    host.handleRemoteMessage(overflowPeer, 'peer_8');

    // Overflow peer must receive ROOM_FULL error
    expect(outboundSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        code: 'ROOM_FULL',
      }),
      'peer_8',
    );
  });

  it('handles pause, seek, rate, and nav local user commands', () => {
    const engine = new SyncEngine({ selfId: 'user1', selfName: 'Alice' });
    const outboundSpy = vi.fn();
    engine.setOutboundHandler(outboundSpy);

    // Initial event: setting URL
    engine.handleLocalPlayerEvent({
      playing: false,
      position: 0,
      rate: 1.0,
      duration: 100,
      buffering: false,
      adPlaying: false,
      url: 'https://youtube.com/watch?v=1',
      origin: 'user',
    });
    const msg = (outboundSpy.mock.calls[0] as [ProtocolMsg, string | undefined])[0];
    expect(msg).toMatchObject({
      type: 'cmd',
      action: 'nav',
      url: 'https://youtube.com/watch?v=1',
    });

    // User presses play
    outboundSpy.mockClear();
    engine.handleLocalPlayerEvent({
      playing: true,
      position: 10.0,
      rate: 1.0,
      duration: 100,
      buffering: false,
      adPlaying: false,
      url: 'https://youtube.com/watch?v=1',
      origin: 'user',
    });
    expect((outboundSpy.mock.calls[0] as [ProtocolMsg, string | undefined])[0]).toMatchObject({
      type: 'cmd',
      action: 'play',
    });

    // User pauses
    outboundSpy.mockClear();
    engine.handleLocalPlayerEvent({
      playing: false,
      position: 10.0,
      rate: 1.0,
      duration: 100,
      buffering: false,
      adPlaying: false,
      url: 'https://youtube.com/watch?v=1',
      origin: 'user',
    });
    expect((outboundSpy.mock.calls[0] as [ProtocolMsg, string | undefined])[0]).toMatchObject({
      type: 'cmd',
      action: 'pause',
    });

    // User seeks to 50.0
    outboundSpy.mockClear();
    engine.handleLocalPlayerEvent({
      playing: false,
      position: 50.0,
      rate: 1.0,
      duration: 100,
      buffering: false,
      adPlaying: false,
      url: 'https://youtube.com/watch?v=1',
      origin: 'user',
    });
    expect((outboundSpy.mock.calls[0] as [ProtocolMsg, string | undefined])[0]).toMatchObject({
      type: 'cmd',
      action: 'seek',
      position: 50,
    });

    // User changes rate to 1.5
    outboundSpy.mockClear();
    engine.handleLocalPlayerEvent({
      playing: false,
      position: 50.0,
      rate: 1.5,
      duration: 100,
      buffering: false,
      adPlaying: false,
      url: 'https://youtube.com/watch?v=1',
      origin: 'user',
    });
    expect((outboundSpy.mock.calls[0] as [ProtocolMsg, string | undefined])[0]).toMatchObject({
      type: 'cmd',
      action: 'rate',
      rate: 1.5,
    });

    // User navigates to new URL
    outboundSpy.mockClear();
    engine.handleLocalPlayerEvent({
      playing: false,
      position: 0,
      rate: 1.0,
      duration: 100,
      buffering: false,
      adPlaying: false,
      url: 'https://youtube.com/watch?v=2',
      origin: 'user',
    });
    expect((outboundSpy.mock.calls[0] as [ProtocolMsg, string | undefined])[0]).toMatchObject({
      type: 'cmd',
      action: 'nav',
      url: 'https://youtube.com/watch?v=2',
    });
  });

  it('handles remote state snapshots and late-join URL alignment', () => {
    const follower = new SyncEngine({ selfId: 'user2', selfName: 'Bob' });
    const localActionSpy = vi.fn();
    follower.setLocalActionHandler(localActionSpy);
    follower.clock.peerJoined('user1'); // user1 is leader

    const remoteState: StateMsg = {
      v: 2,
      type: 'state',
      url: 'https://youtube.com/watch?v=remote',
      playing: true,
      position: 25.0,
      rate: 1.25,
      at: follower.clock.roomTime(),
      hold: false,
    };

    follower.handleRemoteMessage(remoteState, 'user1');

    expect(localActionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'nav', url: 'https://youtube.com/watch?v=remote' }),
    );
    expect(localActionSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'seek' }));
    expect(localActionSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'play' }));
  });

  it('late joiner receives state snapshot from leader immediately (< 3s)', () => {
    const leader = new SyncEngine({ selfId: 'a_leader', selfName: 'Alice' });
    const outboundSpy = vi.fn();
    leader.setOutboundHandler(outboundSpy);

    const state: StateMsg = {
      v: 2,
      type: 'state',
      url: 'https://youtube.com/watch?v=test',
      playing: true,
      position: 45.0,
      rate: 1.0,
      at: Date.now(),
      hold: false,
    };
    (leader as any).roomState = state;

    leader.handleRemoteMessage(
      { v: 2, type: 'hello', peerId: 'z_joiner', name: 'LateJoiner' },
      'z_joiner',
    );

    expect(outboundSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'state',
        url: 'https://youtube.com/watch?v=test',
      }),
      'z_joiner',
    );
  });

  it('tests drift nudge and remaining buffering/state edge cases', () => {
    const leader = new SyncEngine({ selfId: 'a_leader', selfName: 'Alice' });
    const localActionSpy = vi.fn();
    leader.setLocalActionHandler(localActionSpy);

    // Leader receives remote state -> must ignore because self is leader
    const dummyState: StateMsg = {
      v: 2,
      type: 'state',
      url: 'https://youtube.com',
      playing: true,
      position: 10,
      rate: 1,
      at: 1000,
      hold: false,
    };
    leader.handleRemoteMessage(dummyState, 'other_peer');

    // Add peer b and peer c
    leader.handleRemoteMessage({ v: 2, type: 'hello', peerId: 'b_peer', name: 'Bob' }, 'b_peer');
    leader.handleRemoteMessage(
      { v: 2, type: 'hello', peerId: 'c_peer', name: 'Charlie' },
      'c_peer',
    );

    // Peer b and c both buffer
    leader.command('play', 0, 1);
    leader.handleRemoteMessage({ v: 2, type: 'buffering', peerId: 'b_peer', on: true }, 'b_peer');
    leader.handleRemoteMessage({ v: 2, type: 'buffering', peerId: 'c_peer', on: true }, 'c_peer');
    expect(leader.getRoomState().hold).toBe(true);

    // Only b reports ready, c is still buffering -> hold must remain true!
    leader.handleRemoteMessage({ v: 2, type: 'ready', peerId: 'b_peer' }, 'b_peer');
    expect(leader.getRoomState().hold).toBe(true);

    // Charlie also reports ready -> hold is cleared!
    leader.handleRemoteMessage({ v: 2, type: 'ready', peerId: 'c_peer' }, 'c_peer');
    expect(leader.getRoomState().hold).toBe(false);
  });

  it('covers timer lifecycles and start/stop intervals', () => {
    vi.useFakeTimers();
    const leader = new SyncEngine({ selfId: 'a_leader', selfName: 'Alice' });
    const outboundSpy = vi.fn();
    leader.setOutboundHandler(outboundSpy);

    leader.start();
    // Advance timers by 2000ms -> should trigger broadcastState
    vi.advanceTimersByTime(2000);
    expect(outboundSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'state' }), undefined);

    leader.stop();
    vi.useRealTimers();
  });

  it('covers clock ping-pong forwarding, bye message and peer left', () => {
    const leader = new SyncEngine({ selfId: 'a_leader', selfName: 'Alice' });
    const outboundSpy = vi.fn();
    leader.setOutboundHandler(outboundSpy);

    // Leader receives clock.ping from follower
    leader.handleRemoteMessage({ v: 2, type: 'clock.ping', t0: 1000 }, 'b_follower');
    expect(outboundSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'clock.pong', t0: 1000 }),
      'b_follower',
    );

    // Leader receives clock.pong
    leader.handleRemoteMessage(
      { v: 2, type: 'clock.pong', t0: 100, t1: 150, t2: 150 },
      'b_follower',
    );

    // Bye message
    leader.handleRemoteMessage(
      { v: 2, type: 'hello', peerId: 'b_follower', name: 'Bob' },
      'b_follower',
    );
    expect(leader.getPeers().length).toBe(1);
    leader.handleRemoteMessage({ v: 2, type: 'bye', peerId: 'b_follower' }, 'b_follower');
    expect(leader.getPeers().length).toBe(0);
  });

  it('covers scheduled start timer execution', async () => {
    vi.useFakeTimers();
    const engine = new SyncEngine({ selfId: 'user1', selfName: 'Alice' });
    const localActionSpy = vi.fn();
    engine.setLocalActionHandler(localActionSpy);

    const now = engine.clock.roomTime();
    const startAt = now + 250;

    engine.handleRemoteMessage(
      {
        v: 2,
        type: 'cmd',
        lamport: 1,
        from: 'leader',
        action: 'play',
        position: 10,
        rate: 1,
        startAt,
      },
      'leader',
    );

    // Before timer: not yet played
    expect(localActionSpy).not.toHaveBeenCalled();

    // Advance timer past startAt
    vi.advanceTimersByTime(260);
    expect(localActionSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'play' }));

    vi.useRealTimers();
  });

  describe('hostile peers', () => {
    const hello = (peerId: string, uid: string): HelloMsg => ({
      v: 2,
      type: 'hello',
      peerId,
      name: peerId,
      uid,
    });
    const state = (extra: Partial<StateMsg>): StateMsg => ({
      v: 2,
      type: 'state',
      url: 'https://youtube.com/watch?v=1',
      playing: false,
      position: 0,
      rate: 1,
      at: 0,
      hold: false,
      ...extra,
    });

    it('a live peer cannot be evicted by a hello that copies its uid', () => {
      const guest = new SyncEngine({ selfId: 'g', selfName: 'G' });
      guest.setPeerAliveCheck(() => true);
      const uid = 'a'.repeat(32);
      guest.handleRemoteMessage(hello('host', uid), 'host');
      guest.setRoomCreator('host');
      guest.handleRemoteMessage(hello('evil', uid), 'evil');
      expect(
        guest
          .getPeers()
          .map((p) => p.peerId)
          .sort(),
      ).toEqual(['evil', 'host']);
      expect(guest.roomCreatorId).toBe('host');
    });

    it('a newcomer ignores a snapshot that was not sent by the owner', () => {
      const fresh = new SyncEngine({ selfId: 'g', selfName: 'G', awaitingState: true });
      fresh.handleRemoteMessage(hello('evil', 'b'.repeat(32)), 'evil');
      fresh.handleRemoteMessage(state({ ownerId: 'host' }), 'evil');
      expect(fresh.roomCreatorId).toBe('');
    });

    it('rejects a snapshot with an absurd lamport clock', () => {
      const guest = new SyncEngine({ selfId: 'g', selfName: 'G', awaitingState: true });
      guest.handleRemoteMessage(hello('host', 'c'.repeat(32)), 'host');
      guest.handleRemoteMessage(state({ ownerId: 'host', lamport: 2 ** 52 }), 'host');
      expect(guest.roomCreatorId).toBe('');
    });
  });
});
