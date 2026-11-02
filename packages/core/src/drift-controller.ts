import {
  DRIFT_DEADBAND_SEC,
  DRIFT_NUDGE_MAX_SEC,
  DRIFT_NUDGE_RATE,
  HOLD_TOLERANCE_SEC,
} from './constants.js';
import type { StateMsg } from './types.js';

export type DriftCorrection =
  | { type: 'none'; rate: number }
  | { type: 'nudge'; rate: number; error: number }
  | { type: 'seek'; position: number; error: number };

export class DriftController {
  private baseRate = 1.0;

  public setBaseRate(rate: number): void {
    if (rate > 0 && rate <= 16) {
      this.baseRate = rate;
    }
  }

  public getBaseRate(): number {
    return this.baseRate;
  }

  /**
   * Calculates the desired video playback position at current room time
   */
  public calculateDesiredPosition(state: StateMsg, currentRoomTime: number): number {
    if (!state.playing || state.hold) {
      return state.position;
    }

    const elapsedSeconds = Math.max(0, (currentRoomTime - state.at) / 1000);
    return state.position + elapsedSeconds * (state.rate || 1.0);
  }

  /**
   * Evaluates current drift and returns corrective action
   */
  public evaluateDrift(
    currentLocalPos: number,
    state: StateMsg,
    currentRoomTime: number,
  ): DriftCorrection {
    // If held or buffering, keep paused at target position
    if (state.hold) {
      const err = Math.abs(currentLocalPos - state.position);
      if (err > HOLD_TOLERANCE_SEC) {
        return { type: 'seek', position: state.position, error: currentLocalPos - state.position };
      }
      return { type: 'none', rate: 1.0 };
    }

    const desiredPos = this.calculateDesiredPosition(state, currentRoomTime);
    // error > 0: local is ahead of room. error < 0: local is behind room.
    const error = currentLocalPos - desiredPos;
    const absError = Math.abs(error);

    // 1. Error < 0.15s: In deadband -> do nothing (rate back to baseRate)
    if (absError < DRIFT_DEADBAND_SEC) {
      return { type: 'none', rate: this.baseRate };
    }

    // 2. deadband - nudge max: Micro drift -> nudge playbackRate by ±5%
    if (absError <= DRIFT_NUDGE_MAX_SEC) {
      // If we are ahead (error > 0), slow down (0.95 of baseRate)
      // If we are behind (error < 0), speed up (1.05 of baseRate)
      const factor = error > 0 ? 1 - DRIFT_NUDGE_RATE : 1 + DRIFT_NUDGE_RATE;
      const nudgedRate = Number((this.baseRate * factor).toFixed(4));
      return { type: 'nudge', rate: nudgedRate, error };
    }

    // 3. > nudge max: Macro drift -> hard seek
    return { type: 'seek', position: desiredPos, error };
  }
}
