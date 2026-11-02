import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

const DURATION_MS = 420;

interface Snapshot {
  id: string;
  node: ComponentChildren;
  depth: number;
  fx: boolean;
}

/**
 * Cross-slides between screens: the new one enters from the side it is "deeper" in the
 * navigation, while the previous one stays on top of it for a moment and slides away.
 * Transitions are skipped for screens that must not move (the room, onboarding).
 */
export function Screens({
  id,
  depth,
  animate,
  children,
}: {
  id: string;
  depth: number;
  /** Whether this screen may take part in a slide transition. */
  animate: boolean;
  children: ComponentChildren;
}): JSX.Element {
  const prev = useRef<Snapshot>({ id, node: children, depth, fx: animate });
  const [fx, setFx] = useState<{ dir: 'fwd' | 'back'; leaving: Snapshot } | null>(null);
  const reduced = useRef(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  // Runs before paint: decides whether to keep the previous screen around as an exit layer.
  useLayoutEffect(() => {
    const p = prev.current;
    if (p.id === id) return undefined;
    if (!(p.fx && animate) || reduced.current) {
      setFx(null);
      return undefined;
    }
    setFx({ dir: depth >= p.depth ? 'fwd' : 'back', leaving: p });
    const timer = setTimeout(() => setFx(null), DURATION_MS + 40);
    return () => clearTimeout(timer);
  }, [id]);

  // Keep the latest render of the current screen so it can be shown while leaving.
  useLayoutEffect(() => {
    prev.current = { id, node: children, depth, fx: animate };
  });

  return (
    <div class="screens">
      {fx && (
        <div key={`out-${fx.leaving.id}`} class={`screen-layer leave-${fx.dir}`} aria-hidden="true">
          {fx.leaving.node}
        </div>
      )}
      <div key={id} class={`screen-layer${fx ? ` enter-${fx.dir}` : ''}`}>
        {children}
      </div>
    </div>
  );
}
