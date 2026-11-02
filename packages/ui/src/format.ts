import type { T } from './i18n.js';

export function fmtDuration(sec: number, t: T): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} ${t('unitS')}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${t('unitM')}`;
  const h = s / 3600;
  return `${h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)} ${t('unitH')}`;
}

export function fmtDate(ms: number, lang: string): string {
  return new Date(ms).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
}
