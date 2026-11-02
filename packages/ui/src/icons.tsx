import type { JSX } from 'preact';

export type IconName =
  | 'play'
  | 'pause'
  | 'next'
  | 'back10'
  | 'fwd10'
  | 'settings'
  | 'maximize'
  | 'minimize'
  | 'users'
  | 'user'
  | 'message'
  | 'send'
  | 'arrowUp'
  | 'image'
  | 'copy'
  | 'check'
  | 'crown'
  | 'shield'
  | 'logout'
  | 'link'
  | 'x'
  | 'chevronRight'
  | 'chevronLeft'
  | 'gauge'
  | 'monitor'
  | 'camera'
  | 'plus'
  | 'lock'
  | 'alert'
  | 'refresh'
  | 'panel'
  | 'globe'
  | 'volume'
  | 'subtitles';

const P = (d: string) => <path d={d} />;
const PATHS: Record<IconName, JSX.Element> = {
  play: (
    <path
      d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"
      fill="currentColor"
    />
  ),
  pause: (
    <>
      <rect x="5.5" y="4" width="4.6" height="16" rx="2.2" fill="currentColor" />
      <rect x="13.9" y="4" width="4.6" height="16" rx="2.2" fill="currentColor" />
    </>
  ),
  next: (
    <>
      <path
        d="M5 5.5v13a.9.9 0 0 0 1.4.75l8.6-6.5a.9.9 0 0 0 0-1.5L6.4 4.75A.9.9 0 0 0 5 5.5z"
        fill="currentColor"
      />
      <rect x="17" y="5" width="2.8" height="14" rx="1.4" fill="currentColor" />
    </>
  ),
  back10: (
    <>
      {P('M3 12a9 9 0 1 0 2.64-6.36L3 8')}
      {P('M3 3v5h5')}
      <text
        x="12"
        y="15.5"
        font-size="8.5"
        font-weight="700"
        text-anchor="middle"
        fill="currentColor"
        stroke="none"
      >
        10
      </text>
    </>
  ),
  fwd10: (
    <>
      {P('M21 12a9 9 0 1 1-2.64-6.36L21 8')}
      {P('M21 3v5h-5')}
      <text
        x="12"
        y="15.5"
        font-size="8.5"
        font-weight="700"
        text-anchor="middle"
        fill="currentColor"
        stroke="none"
      >
        10
      </text>
    </>
  ),
  settings: (
    <>
      {P(
        'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
      )}
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  maximize: P(
    'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3',
  ),
  minimize: P(
    'M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3',
  ),
  users: (
    <>
      {P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2')}
      <circle cx="9" cy="7" r="4" />
      {P('M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75')}
    </>
  ),
  user: (
    <>
      {P('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2')}
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  message: P('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'),
  send: (
    <>
      {P('m22 2-7 20-4-9-9-4z')}
      {P('M22 2 11 13')}
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="9" cy="9" r="1.6" />
      {P('m21 15-4.5-4.5L6 21')}
    </>
  ),
  arrowUp: P('M12 19V5M5.5 11.5 12 5l6.5 6.5'),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      {P('M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1')}
    </>
  ),
  check: P('M20 6 9 17l-5-5'),
  crown: P('m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14'),
  shield: (
    <>
      {P(
        'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
      )}
      {P('m9 12 2 2 4-4')}
    </>
  ),
  logout: P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'),
  link: P(
    'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  ),
  x: P('M18 6 6 18M6 6l12 12'),
  chevronRight: P('m9 18 6-6-6-6'),
  chevronLeft: P('m15 18-6-6 6-6'),
  gauge: (
    <>
      {P('m12 14 4-4')}
      {P('M3.34 19a10 10 0 1 1 17.32 0')}
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      {P('M8 21h8M12 17v4')}
    </>
  ),
  camera: (
    <>
      {P('M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z')}
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  plus: P('M12 5v14M5 12h14'),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      {P('M7 11V7a5 5 0 0 1 10 0v4')}
    </>
  ),
  alert: (
    <>
      {P('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3')}
      {P('M12 9v4M12 17h.01')}
    </>
  ),
  refresh: P(
    'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
  ),
  panel: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      {P('M15 3v18')}
    </>
  ),
  volume: (
    <>
      {P('M11 5 6 9H2v6h4l5 4z')}
      {P('M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14')}
    </>
  ),
  subtitles: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      {P('M7 12h3M13 12h4M7 15.5h6M16 15.5h1')}
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      {P(
        'M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
      )}
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  stroke = 2,
  class: cls,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
  class?: string;
}): JSX.Element {
  return (
    <svg
      class={cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

export function Logo({ size = 40 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="14" fill="#fff" />
      <path
        d="M19 14.5v19a1.2 1.2 0 0 0 1.82 1l15-9.5a1.2 1.2 0 0 0 0-2l-15-9.5a1.2 1.2 0 0 0-1.82 1z"
        fill="#000"
      />
      <circle cx="12" cy="24" r="2.4" fill="#000" opacity=".8" />
    </svg>
  );
}
