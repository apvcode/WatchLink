import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { T } from '../i18n.js';
import { cropToAvatar } from '../profile.js';

const MAX_ZOOM = 5;

/** Full-screen photo cropper: the whole picture stays visible, the circle shows what is kept. */
export function AvatarCropper({
  t,
  file,
  onDone,
  onCancel,
}: {
  t: T;
  file: File;
  onDone: (avatar: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0); // quarter turns
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [touching, setTouching] = useState(false);
  const [error, setError] = useState('');
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    ox: number;
    oy: number;
    x: number;
    y: number;
    dist: number;
    z: number;
  }>();

  useEffect(() => {
    let alive = true;
    createImageBitmap(file)
      .then((b) => alive && setBitmap(b))
      .catch(() => alive && setError('Не удалось открыть фото / Cannot open the photo'));
    return () => {
      alive = false;
    };
  }, [file]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const D = Math.max(120, Math.min(size.w - 40, size.h - 40, 420));
  const rw = bitmap ? (rot % 2 ? bitmap.height : bitmap.width) : 1;
  const rh = bitmap ? (rot % 2 ? bitmap.width : bitmap.height) : 1;
  const base = bitmap ? D / Math.min(rw, rh) : 1;
  const scale = base * zoom;

  const clamp = (o: { x: number; y: number }, z = zoom, r = rot) => {
    if (!bitmap) return o;
    const w = r % 2 ? bitmap.height : bitmap.width;
    const h = r % 2 ? bitmap.width : bitmap.height;
    const s = (D / Math.min(w, h)) * z;
    const mx = Math.max(0, (w * s - D) / 2);
    const my = Math.max(0, (h * s - D) / 2);
    return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
  };

  // Keep the picture covering the circle when the stage or rotation changes.
  useEffect(() => {
    setOff((o) => clamp(o));
  }, [D, rot, bitmap]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !bitmap || !size.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(size.w / 2 + off.x, size.h / 2 + off.y);
    ctx.rotate((rot * Math.PI) / 2);
    ctx.scale(scale, scale);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  }, [bitmap, size, scale, off, rot]);

  const setZoomClamped = (z: number) => {
    const next = Math.max(1, Math.min(MAX_ZOOM, z));
    setZoom(next);
    setOff((o) => clamp(o, next));
  };

  const confirm = async () => {
    if (!bitmap || busy) return;
    setBusy(true);
    try {
      const OUT = 192;
      const k = OUT / D;
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = OUT;
      const ctx = tmp.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(OUT / 2 + off.x * k, OUT / 2 + off.y * k);
      ctx.rotate((rot * Math.PI) / 2);
      ctx.scale(scale * k, scale * k);
      ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
      onDone(cropToAvatar(await createImageBitmap(tmp)));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const onDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setTouching(true);
    const pts = [...pointers.current.values()];
    const p0 = pts[0] as { x: number; y: number };
    const p1 = pts[1];
    gesture.current = {
      ox: off.x,
      oy: off.y,
      x: p0.x,
      y: p0.y,
      dist: p1 ? Math.hypot(p1.x - p0.x, p1.y - p0.y) : 0,
      z: zoom,
    };
  };
  const onMove = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    const p0 = pts[0] as { x: number; y: number };
    const p1 = pts[1];
    if (p1 && g.dist > 0) {
      setZoomClamped(g.z * (Math.hypot(p1.x - p0.x, p1.y - p0.y) / g.dist));
    } else {
      setOff(clamp({ x: g.ox + p0.x - g.x, y: g.oy + p0.y - g.y }));
    }
  };
  const onUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      setTouching(false);
      gesture.current = undefined;
    } else {
      const p0 = [...pointers.current.values()][0] as { x: number; y: number };
      gesture.current = { ox: off.x, oy: off.y, x: p0.x, y: p0.y, dist: 0, z: zoom };
    }
  };

  return (
    <div class="cropper" role="dialog" aria-modal="true">
      <div class="cropper-top">
        <b>{t('cropTitle')}</b>
        <span>{t('cropHint')}</span>
      </div>
      <div
        ref={stage}
        class={`cropper-stage${touching ? ' touching' : ''}`}
        style={{ '--d': `${D}px` } as JSX.CSSProperties}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={(e) => {
          e.preventDefault();
          setZoomClamped(zoom - e.deltaY * 0.002);
        }}
      >
        <canvas ref={canvas} style={{ width: `${size.w}px`, height: `${size.h}px` }} />
        <div class="cropper-mask" />
        <div class="cropper-ring" />
      </div>
      <div class="cropper-bottom">
        {error && <small style={{ color: 'var(--bad)' }}>{error}</small>}
        <div class="cropper-zoom">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            aria-hidden="true"
          >
            <rect x="5" y="5" width="14" height="14" rx="3" />
          </svg>
          <input
            class="seek"
            type="range"
            min="1"
            max={MAX_ZOOM}
            step="0.01"
            value={zoom}
            aria-label="Zoom"
            style={{ '--p': `${((zoom - 1) / (MAX_ZOOM - 1)) * 100}%` } as JSX.CSSProperties}
            onInput={(e) => setZoomClamped(Number((e.currentTarget as HTMLInputElement).value))}
          />
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="4" />
          </svg>
        </div>
        <div class="cropper-actions">
          <button type="button" class="btn btn-ghost" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            type="button"
            class="cropper-rotate"
            aria-label="Rotate"
            onClick={() => setRot((r) => (r + 1) % 4)}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20 12a8 8 0 1 1-2.6-5.9" />
              <path d="M20 4v5h-5" />
            </svg>
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!bitmap || busy}
            onClick={confirm}
          >
            {t('cropDone')}
          </button>
        </div>
      </div>
    </div>
  );
}
