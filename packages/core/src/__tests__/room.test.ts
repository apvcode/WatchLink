import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const transports: any[] = [];
  const join = vi.fn(() => {
    const action = { send: vi.fn(async () => {}), onMessage: null, onReceive: null };
    const room = {
      makeAction: vi.fn(() => action),
      leave: vi.fn(async () => {}),
      onPeerJoin: null,
      onPeerLeave: null,
    };
    transports.push({ room, action });
    return room;
  });
  return { join, transports, sockets: { relay: { readyState: 1 } } };
});
vi.mock('@trystero-p2p/nostr', () => ({
  joinRoom: mocks.join,
  selfId: 'self',
  getRelaySockets: () => mocks.sockets,
}));
vi.mock('@trystero-p2p/mqtt', () => ({
  joinRoom: mocks.join,
  selfId: 'self',
  getRelaySockets: () => mocks.sockets,
}));

import { WatchLinkRoom } from '../room.js';

describe('room transport integration', () => {
  let room: WatchLinkRoom;
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.transports.length = 0;
    room = new WatchLinkRoom({ userName: 'Alice', isHost: true });
  });
  afterEach(() => {
    room.disconnect();
    vi.useRealTimers();
  });
  it('uses the installed Trystero action object and transport identity', async () => {
    await room.connect();
    expect(room.selfId).toBe('self');
    const { room: transport, action } = mocks.transports[0];
    transport.onPeerJoin('bob');
    expect(JSON.parse(action.send.mock.calls[0][0])).toMatchObject({
      type: 'hello',
      peerId: 'self',
      v: 2,
    });
    action.onMessage(JSON.stringify({ v: 2, type: 'hello', peerId: 'bob', name: 'Bob' }), {
      peerId: 'bob',
    });
    room.sendChat('Hello');
    expect(JSON.parse(action.send.mock.calls.at(-1)[0])).toMatchObject({
      type: 'chat',
      text: 'Hello',
    });
    expect(room.syncEngine.getPeers()).toHaveLength(1);
  });
  it('adds fallback after eight seconds without removing primary discovery', async () => {
    await room.connect();
    vi.advanceTimersByTime(8000);
    expect(mocks.transports).toHaveLength(2);
    expect(mocks.transports[0].room.leave).not.toHaveBeenCalled();
    room.disconnect();
    expect(mocks.transports.every((t) => t.room.leave.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects spoofed hello and oversized messages before accepting peers', async () => {
    await room.connect();
    const t = mocks.transports[0];
    t.room.onPeerJoin('bob');
    t.action.onMessage(JSON.stringify({ v: 2, type: 'hello', peerId: 'alice', name: 'Forged' }), {
      peerId: 'bob',
    });
    expect(room.syncEngine.getPeers()).toHaveLength(0);
    expect(t.action.onReceive({ byteLength: 8193 })).toBe(false);
  });
  it('generates secure invitations and rejects unknown strategies', () => {
    expect(WatchLinkRoom.parseInviteCode(room.getInviteCode())).toMatchObject({
      roomId: room.roomId,
      secret: room.secret,
    });
    expect(room.secret).toMatch(/^[a-f0-9]{32}$/);
    expect(WatchLinkRoom.parseInviteCode(`roomId=a&secret=abcdefgh&strategy=garbage`)).toBeNull();
  });
});
