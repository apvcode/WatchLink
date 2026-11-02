/** Downscale a photo to a small JPEG and return its base64 payload (no data: prefix). */
const MAX_BASE64 = 40 * 6000; // matches IMG_MAX_CHUNKS * IMG_CHUNK_CHARS in core

export async function photoToBase64(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    for (const [dim, quality] of [
      [1024, 0.72],
      [900, 0.6],
      [720, 0.55],
      [560, 0.5],
    ] as const) {
      const scale = Math.min(1, dim / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', quality);
      const base64 = url.slice(url.indexOf(',') + 1);
      if (base64.length <= MAX_BASE64) return base64;
    }
    return null;
  } finally {
    bitmap.close();
  }
}
