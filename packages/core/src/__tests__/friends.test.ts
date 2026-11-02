import { describe, expect, it } from 'vitest';
import type { Channel, ChannelFactory, ChannelHandlers, ChannelOptions } from '../channel.js';
import {
  derivePubId,
  type FriendsData,
  FriendsManager,
  type FriendsStorage,
  friendCode,
  parseFriendCode,
} from '../friends.js';

/** In-memory stand-in for Trystero: same room name + password => peers meet. */
function makeHub(): ChannelFactory {
  const rooms = new Map<string, Map<string, ChannelHandlers>>();
  let n = 0;
  return (opts: ChannelOptions, handlers: ChannelHandlers): Channel => {
    const key = `${opts.roomName}|${opts.password}`;
    const id = `peer${++n}`;
    const room = rooms.get(key) ?? new Map<string, ChannelHandlers>();
    rooms.set(key, room);
    queueMicrotask(() => {
      for (const [otherId, other] of room) {
        other.onPeerJoin(id);
        handlers.onPeerJoin(otherId);
      }
      room.set(id, handlers);
    });
    return {
      send(msg, peerId) {
        const data = JSON.parse(JSON.stringify(msg));
        queueMicrotask(() => {
          for (const [otherId, other] of room)
            if (otherId !== id && (!peerId || peerId === otherId)) other.onMessage(data, id);
        });
      },
      leave() {
        room.delete(id);
        for (const other of room.values()) other.onPeerLeave(id);
      },
    };
  };
}

const store = (): FriendsStorage & { data: FriendsData } => {
  const s = {
    data: { friends: [], incoming: [], outgoing: [] } as FriendsData,
    load: () => s.data,
    save: (d: FriendsData) => {
      s.data = d;
    },
  };
  return s;
};
const tick = () => new Promise((r) => setTimeout(r, 20));

async function pair() {
  const channel = makeHub();
  const a = new FriendsManager({
    self: { pub: await derivePubId('a'), name: 'Alice' },
    storage: store(),
    channel,
  });
  const b = new FriendsManager({
    self: { pub: await derivePubId('b'), name: 'Bob' },
    storage: store(),
    channel,
  });
  return { a, b };
}

describe('FriendsManager', () => {
  it('parses friend codes', async () => {
    const pub = await derivePubId('x');
    expect(parseFriendCode(friendCode(pub))).toBe(pub);
    expect(parseFriendCode(pub)).toBe(pub);
    expect(parseFriendCode('nope')).toBeNull();
  });

  it('request -> accept -> presence -> invite', async () => {
    const { a, b } = await pair();
    a.start();
    b.start();
    expect(a.sendRequest(friendCode(b.pub))).toBe('ok');
    await tick();
    expect(b.snapshot().incoming.map((r) => r.name)).toEqual(['Alice']);
    await b.accept(a.pub);
    await tick();
    expect(a.snapshot().friends.map((f) => f.name)).toEqual(['Bob']);
    expect(b.snapshot().friends.map((f) => f.name)).toEqual(['Alice']);
    expect(a.snapshot().outgoing).toEqual([]);
    expect(a.snapshot().presence[b.pub]?.online).toBe(true);
    expect(b.snapshot().presence[a.pub]?.online).toBe(true);

    b.setStatus('watching');
    await tick();
    expect(a.snapshot().presence[b.pub]?.status).toBe('watching');

    a.invite([b.pub], 'wl://join#roomId=abc&secret=12345678', 'Movie');
    await tick();
    expect(b.snapshot().presence[a.pub]?.invite?.title).toBe('Movie');

    a.stop();
    await tick();
    expect(b.snapshot().presence[a.pub]?.online).toBe(false);
  });

  it('mutual requests end in exactly one friendship with one secret', async () => {
    const { a, b } = await pair();
    a.start();
    b.start();
    a.sendRequest(friendCode(b.pub));
    b.sendRequest(friendCode(a.pub));
    await tick();
    await tick();
    const fa = a.snapshot().friends[0];
    const fb = b.snapshot().friends[0];
    expect(fa?.secret).toBeDefined();
    expect(fa?.secret).toBe(fb?.secret);
    expect(a.snapshot().presence[b.pub]?.online).toBe(true);
  });

  it('rejects self, duplicates, bad codes and forged invites', async () => {
    const { a, b } = await pair();
    a.start();
    expect(a.sendRequest(friendCode(a.pub))).toBe('self');
    expect(a.sendRequest('garbage')).toBe('invalid');
    b.start();
    a.sendRequest(friendCode(b.pub));
    await tick();
    await b.accept(a.pub);
    await tick();
    expect(a.sendRequest(friendCode(b.pub))).toBe('known');
    a.invite([b.pub], 'https://evil.example', 'x');
    await tick();
    expect(b.snapshot().presence[a.pub]?.invite).toBeUndefined();
  });

  it('decline removes the request on both sides', async () => {
    const { a, b } = await pair();
    a.start();
    b.start();
    a.sendRequest(friendCode(b.pub));
    await tick();
    b.decline(a.pub);
    await tick();
    expect(b.snapshot().incoming).toEqual([]);
    expect(a.snapshot().outgoing).toEqual([]);
    expect(a.snapshot().friends).toEqual([]);
  });
});
