import type { Profile } from './types.js';

const KEY = 'watchlink:profile';

function randomUid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function loadProfile(): Profile | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && /^[a-f0-9]{32}$/.test(raw.uid) && typeof raw.name === 'string' && raw.name.trim())
      return { uid: raw.uid, name: raw.name.slice(0, 24), avatar: raw.avatar || undefined };
  } catch {}
  return null;
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {}
}

/** Creates the profile identity once; it stays bound to this device's storage. */
export function createProfile(name: string, avatar?: string): Profile {
  const profile = { uid: randomUid(), name: name.trim().slice(0, 24), avatar };
  saveProfile(profile);
  return profile;
}

/**
 * Renders the square region (sx, sy, side) of the image into a tiny JPEG that fits one
 * protocol message. Defaults to the centered square.
 */
export function cropToAvatar(
  bitmap: ImageBitmap,
  region?: { sx: number; sy: number; side: number },
): string {
  const side0 = Math.min(bitmap.width, bitmap.height);
  const r = region ?? {
    sx: (bitmap.width - side0) / 2,
    sy: (bitmap.height - side0) / 2,
    side: side0,
  };
  for (const size of [96, 72, 64, 48]) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    ctx.drawImage(bitmap, r.sx, r.sy, r.side, r.side, 0, 0, size, size);
    for (const quality of [0.8, 0.65, 0.5, 0.35]) {
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.length <= 5000) return url;
    }
  }
  throw new Error('Image is too complex / Изображение слишком сложное');
}

/** Center-crops an image file to an avatar. */
export async function fileToAvatar(file: File): Promise<string> {
  return cropToAvatar(await createImageBitmap(file));
}

export function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) return u.searchParams.get('v');
  } catch {}
  return null;
}
