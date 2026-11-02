import type { JSX } from 'preact';
import { Icon } from '../icons.js';
import { hueFor } from '../profile.js';

export function Avatar({
  name,
  avatar,
  size = 40,
  host = false,
}: {
  name: string;
  avatar?: string;
  size?: number;
  host?: boolean;
}): JSX.Element {
  const shade = 22 + (hueFor(name || '?') % 5) * 5;
  const style: JSX.CSSProperties = { '--s': `${size}px` } as JSX.CSSProperties;
  if (avatar) style.backgroundImage = `url(${avatar})`;
  else style.background = `linear-gradient(145deg, hsl(0 0% ${shade + 14}%), hsl(0 0% ${shade}%))`;
  return (
    <div class={`avatar${host ? ' host' : ''}`} style={style} title={name}>
      {!avatar && (name.trim()[0] ?? '?').toUpperCase()}
      {host && (
        <span class="crown">
          <Icon name="crown" size={Math.max(12, size * 0.34)} stroke={2.4} />
        </span>
      )}
    </div>
  );
}
