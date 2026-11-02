import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncEngine } from '../sync-engine.js';

const report = {
  position: 10,
  rate: 1,
  duration: 100,
  playing: true,
  buffering: false,
  adPlaying: false,
  url: 'https://example.com/video',
  origin: 'program' as const,
};
afterEach(() => vi.useRealTimers());
describe('buffering recovery and clock samples', () => {
  it('ignores a short buffering transition', () => {
    vi.useFakeTimers();
    const engine = new SyncEngine({ selfId: 'a', selfName: 'a', bufferingDelayMs: 400 });
    engine.command('play', 10, 1);
    engine.handleLocalPlayerEvent({ ...report, buffering: true });
    vi.advanceTimersByTime(200);
    engine.handleLocalPlayerEvent(report);
    vi.advanceTimersByTime(300);
    expect(engine.isHoldActive()).toBe(false);
    engine.stop();
  });
  it('a user pause cancels the hold and its automatic resume', () => {
    vi.useFakeTimers();
    const engine = new SyncEngine({ selfId: 'a', selfName: 'a', bufferingDelayMs: 400 });
    const action = vi.fn();
    engine.setLocalActionHandler(action);
    engine.command('play', 10, 1);
    engine.handleLocalPlayerEvent({ ...report, buffering: true });
    vi.advanceTimersByTime(500);
    expect(engine.isHoldActive()).toBe(true);
    engine.command('pause', 10);
    action.mockClear();
    vi.advanceTimersByTime(6000);
    expect(engine.getRoomState().playing).toBe(false);
    expect(action).not.toHaveBeenCalled();
    engine.stop();
  });
  it('does not mistake a 400ms old playback sample for drift', () => {
    let now = 1000;
    const engine = new SyncEngine({ selfId: 'z', selfName: 'follower', nowFn: () => now });
    engine.handleRemoteMessage({ v: 2, type: 'hello', peerId: 'a', name: 'leader' }, 'a');
    engine.handleRemoteMessage(
      {
        v: 2,
        type: 'state',
        url: report.url,
        playing: true,
        position: 10,
        rate: 1,
        at: now,
        hold: false,
      },
      'a',
    );
    engine.handleLocalPlayerEvent(report);
    now += 400;
    expect(engine.tickDrift().type).toBe('none');
    engine.stop();
  });
});
