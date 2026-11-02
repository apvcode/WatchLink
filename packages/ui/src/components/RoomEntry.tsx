import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Logo } from '../icons.js';

const MIN_MS = 1300; // always show the animation long enough to read
const LEAVE_MS = 850;
const MAX_MS = 40000; // hard cap; the room reports its own timeout first
const FAIL_MS = 2200;

/**
 * Transition played when a room is created or joined. A ring orbits the logo while the
 * room connects, then closes into a full circle and the screen opens onto the room.
 */
export function RoomEntry({
  mode,
  roomId,
  label,
  ready,
  failed,
  failLabel,
  failHint,
  onFail,
  onDone,
}: {
  mode: 'create' | 'join' | 'leave';
  roomId: string;
  label: string;
  /** True once signaling has connected (or failed): the ring may close. */
  ready: boolean;
  /** Joining failed: the ring turns red and shakes, then onFail runs. */
  failed?: boolean;
  failLabel?: string;
  failHint?: string;
  onFail?: () => void;
  onDone: () => void;
}): JSX.Element {
  const [phase, setPhase] = useState<'wait' | 'done' | 'out' | 'fail'>('wait');
  const started = useRef(Date.now());
  // Keep the latest callback without restarting timers on every parent render.
  const doneCb = useRef(onDone);
  doneCb.current = onDone;
  const reduced = useRef(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  const wasFail = useRef(false);
  if (phase === 'fail') wasFail.current = true;
  const failCb = useRef(onFail);
  failCb.current = onFail;
  useEffect(() => {
    if (failed && mode === 'join' && (phase === 'wait' || phase === 'done')) setPhase('fail');
  }, [failed, mode, phase]);

  useEffect(() => {
    if (phase !== 'fail') return;
    const t = setTimeout(
      () => {
        failCb.current?.();
        setPhase('out');
      },
      reduced.current ? 400 : FAIL_MS,
    );
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'wait' || (failed && mode === 'join')) return;
    const elapsed = Date.now() - started.current;
    const min = mode === 'leave' ? LEAVE_MS : MIN_MS;
    const wait = ready ? Math.max(0, min - elapsed) : Math.max(0, MAX_MS - elapsed);
    const t = setTimeout(() => setPhase('done'), reduced.current ? 0 : wait);
    return () => clearTimeout(t);
  }, [ready, phase, mode, failed]);

  useEffect(() => {
    if (phase === 'done') {
      const t = setTimeout(() => setPhase('out'), reduced.current ? 0 : 550);
      return () => clearTimeout(t);
    }
    if (phase === 'out') {
      const t = setTimeout(() => doneCb.current(), reduced.current ? 0 : 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase]);

  return (
    <div class={`entry ${mode} ${phase}`} aria-hidden="true">
      <div class="entry-glow" />
      <div class="entry-stage">
        <svg class="entry-ring" viewBox="0 0 140 140">
          <circle class="track" cx="70" cy="70" r="62" />
          <circle class="arc" cx="70" cy="70" r="62" pathLength="100" />
        </svg>
        <div class="entry-logo">
          <Logo size={76} />
        </div>
      </div>
      <div class="entry-text">
        <b>{wasFail.current ? failLabel : label}</b>
        {wasFail.current && failHint && <small>{failHint}</small>}
        {mode === 'create' && phase !== 'fail' && roomId && <span class="tabular">#{roomId}</span>}
      </div>
    </div>
  );
}
