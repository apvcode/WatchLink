import type { JSX } from 'preact';
import type { AppState } from '../types.js';

const rgb = (c: [number, number, number] | undefined) =>
  c ? `rgb(${c[0]},${c[1]},${c[2]})` : 'transparent';

/** Soft glow around the video that follows the picture's edge colours (like YouTube's ambient mode). */
export function Ambient({
  colors,
  on,
}: {
  colors: AppState['ambient'];
  on: boolean;
}): JSX.Element | null {
  if (!colors) return null;
  const [top, right, bottom, left] = colors;
  return (
    <div
      class={`ambient${on ? ' on' : ''}`}
      aria-hidden="true"
      style={{ '--ct': rgb(top), '--cr': rgb(right), '--cb': rgb(bottom), '--cl': rgb(left) }}
    />
  );
}
