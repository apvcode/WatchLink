import { describe, expect, it, vi } from 'vitest';
import { SyncEngine } from '../sync-engine.js';
import type { ProtocolMsg } from '../types.js';

describe('late join', () => {
  it('keeps the host as clock leader when a newcomer with a lower id joins, and catches up', () => {
    let now = 1_000_000;
    const host = new SyncEngine({
      selfId: 'zz_host',
      selfName: 'Host',
      roomCreatorId: 'zz_host',
      nowFn: () => now,
    });
    const hostOut: Array<[ProtocolMsg, string | undefined]> = [];
    host.setOutboundHandler((m, t) => hostOut.push([m, t]));
    host.command('nav', undefined, undefined, 'https://www.youtube.com/watch?v=abc');
    host.command('play', 10, 1);
    now += 5000;

    host.handleRemoteMessage({ v: 2, type: 'hello', peerId: 'aa_new', name: 'New' }, 'aa_new');
    expect(host.clock.getLeaderId()).toBe('zz_host');
    const stateMsg = hostOut.find(([m, t]) => m.type === 'state' && t === 'aa_new');
    expect(stateMsg).toBeTruthy();

    const guest = new SyncEngine({
      selfId: 'aa_new',
      selfName: 'New',
      awaitingState: true,
      nowFn: () => now,
    });
    const actions = vi.fn();
    guest.setLocalActionHandler(actions);
    guest.handleRemoteMessage({ v: 2, type: 'hello', peerId: 'zz_host', name: 'Host' }, 'zz_host');
    expect(guest.clock.isLeader()).toBe(false);
    guest.handleRemoteMessage(stateMsg?.[0] as ProtocolMsg, 'zz_host');
    expect(guest.clock.getLeaderId()).toBe('zz_host');
    expect(guest.roomCreatorId).toBe('zz_host');
    expect(actions).toHaveBeenCalledWith(expect.objectContaining({ type: 'nav' }));
    const seek = actions.mock.calls.find(([a]) => a.type === 'seek')?.[0];
    expect(seek?.position).toBeGreaterThan(14);
  });

  it('replaces a ghost entry when the same device uid re-joins', () => {
    const engine = new SyncEngine({ selfId: 'host', selfName: 'H', roomCreatorId: 'host' });
    const uid = 'a'.repeat(32);
    engine.handleRemoteMessage({ v: 2, type: 'hello', peerId: 'old', name: 'Z', uid }, 'old');
    engine.handleRemoteMessage({ v: 2, type: 'hello', peerId: 'new', name: 'Z', uid }, 'new');
    expect(engine.getPeers().map((p) => p.peerId)).toEqual(['new']);
  });
});
