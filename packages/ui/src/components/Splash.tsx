import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

const WORD = 'WatchLink'.split('');

/** Launch animation: the logo draws itself, the wordmark rises in, then the logo flies to its place. */
export function Splash(): JSX.Element | null {
  const [gone, setGone] = useState(false);
  const [phase, setPhase] = useState<'play' | 'handoff' | 'fade'>('play');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const html = document.documentElement;
    const finish = () => {
      html.classList.remove('splash-active');
      setGone(true);
    };
    const start = setTimeout(
      () => {
        const target = document.querySelector('[data-splash-target] svg');
        const mark = root.current?.querySelector<HTMLElement>('.splash-mark');
        if (!target || !mark || reduced) {
          setPhase('fade');
          setTimeout(finish, 750);
          return;
        }
        const a = mark.getBoundingClientRect();
        const b = target.getBoundingClientRect();
        const k = b.width / a.width;
        mark.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${
          b.top + b.height / 2 - (a.top + a.height / 2)
        }px) scale(${k})`;
        setPhase('handoff');
        setTimeout(finish, 1000);
      },
      reduced ? 300 : 2300,
    );
    return () => {
      clearTimeout(start);
      html.classList.remove('splash-active');
    };
  }, []);
  if (gone) return null;
  return (
    <div ref={root} class={`splash ${phase}`} aria-hidden="true">
      <div class="splash-core">
        <div class="splash-mark">
          <div class="splash-glow" />
          <div class="splash-rings">
            <i />
            <i />
            <i />
          </div>
          <svg class="splash-logo" width="112" height="112" viewBox="0 0 48 48">
            <rect class="sl-fill" width="48" height="48" rx="14" fill="#fff" />
            <rect
              class="sl-stroke"
              x="0.75"
              y="0.75"
              width="46.5"
              height="46.5"
              rx="13.3"
              fill="none"
              stroke="#fff"
              stroke-width="1.5"
              pathLength="100"
            />
            <path
              class="sl-play"
              d="M19 14.5v19a1.2 1.2 0 0 0 1.82 1l15-9.5a1.2 1.2 0 0 0 0-2l-15-9.5a1.2 1.2 0 0 0-1.82 1z"
              fill="#000"
            />
            <circle class="sl-dot" cx="12" cy="24" r="2.4" fill="#000" opacity=".8" />
          </svg>
        </div>
        <div class="splash-word">
          {WORD.map((c, i) => (
            <span key={`${c}-${i}`} style={{ animationDelay: `${1.05 + i * 0.055}s` }}>
              {c}
            </span>
          ))}
        </div>
        <div class="splash-sub">Watch together, perfectly in sync</div>
      </div>
    </div>
  );
}
