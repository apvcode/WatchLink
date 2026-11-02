import { GDriveAdapter } from './gdrive.js';
import { GenericAdapter } from './generic.js';
import type { PlayerAdapter, PlayerController } from './types.js';
import { VKVideoAdapter } from './vk.js';
import { YouTubeAdapter } from './youtube.js';

export const ALL_ADAPTERS: PlayerAdapter[] = [
  new YouTubeAdapter(),
  new VKVideoAdapter(),
  new GDriveAdapter(),
  new GenericAdapter(),
];

export function resolveAdapter(url: string): PlayerAdapter {
  for (const adapter of ALL_ADAPTERS) {
    if (adapter.matches(url)) {
      return adapter;
    }
  }
  return ALL_ADAPTERS[ALL_ADAPTERS.length - 1] as PlayerAdapter; // Fallback to GenericAdapter
}

export function attachAdapter(
  win: Window,
  url?: string,
): { adapter: PlayerAdapter; controller: PlayerController } | null {
  const targetUrl = url || win.location?.href || '';
  const adapter = resolveAdapter(targetUrl);
  const controller = adapter.attach(win);
  if (!controller) return null;
  return { adapter, controller };
}
