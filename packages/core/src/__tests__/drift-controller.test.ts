import { describe, expect, it } from 'vitest';
import { DriftController } from '../drift-controller.js';
import type { StateMsg } from '../types.js';

describe('DriftController', () => {
  const baseState: StateMsg = {
    v: 2,
    type: 'state',
    url: 'https://youtube.com/watch?v=test',
    playing: true,
    position: 10.0,
    rate: 1.0,
    at: 1000000,
    hold: false,
  };

  it('calculates desired position correctly based on elapsed room time and rate', () => {
    const controller = new DriftController();
    // 5 seconds elapsed room time
    const desired = controller.calculateDesiredPosition(baseState, 1005000);
    expect(desired).toBeCloseTo(15.0, 2);

    // 2x playback rate -> 10s progress
    const fastState = { ...baseState, rate: 2.0 };
    const fastDesired = controller.calculateDesiredPosition(fastState, 1005000);
    expect(fastDesired).toBeCloseTo(20.0, 2);
  });

  it('returns none within deadband (< 3s error)', () => {
    const controller = new DriftController();
    const roomNow = 1005000; // desired = 15.0
    // Local pos is 17.0 (2s ahead -> within the 3s deadband)
    const res = controller.evaluateDrift(17.0, baseState, roomNow);
    expect(res.type).toBe('none');
    if (res.type === 'none') {
      expect(res.rate).toBe(1.0);
    }
  });

  it('nudges rate by 5% within micro-drift window (3s - 10s)', () => {
    const controller = new DriftController();
    const roomNow = 1005000; // desired = 15.0

    // Ahead by 5s -> slow down (0.95)
    const aheadRes = controller.evaluateDrift(20.0, baseState, roomNow);
    expect(aheadRes.type).toBe('nudge');
    if (aheadRes.type === 'nudge') {
      expect(aheadRes.rate).toBe(0.95);
    }

    // Behind by 5s -> speed up (1.05)
    const behindRes = controller.evaluateDrift(10.0, baseState, roomNow);
    expect(behindRes.type).toBe('nudge');
    if (behindRes.type === 'nudge') {
      expect(behindRes.rate).toBe(1.05);
    }
  });

  it('triggers hard seek on macro-drift (> 10s error)', () => {
    const controller = new DriftController();
    const roomNow = 1005000; // desired = 15.0

    // Local pos is 30.0 (15s ahead)
    const seekRes = controller.evaluateDrift(30.0, baseState, roomNow);
    expect(seekRes.type).toBe('seek');
    if (seekRes.type === 'seek') {
      expect(seekRes.position).toBeCloseTo(15.0, 2);
    }
  });

  it('holds paused position when state.hold is active', () => {
    const controller = new DriftController();
    const heldState: StateMsg = { ...baseState, hold: true };
    const res = controller.evaluateDrift(10.05, heldState, 1005000);
    expect(res.type).toBe('none');

    // If local was far from hold position, seeks back to hold position
    const farRes = controller.evaluateDrift(12.0, heldState, 1005000);
    expect(farRes.type).toBe('seek');
    if (farRes.type === 'seek') {
      expect(farRes.position).toBe(10.0);
    }
  });
});
