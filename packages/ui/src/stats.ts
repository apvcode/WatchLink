/** Local watch statistics. Everything lives on this device; friends will receive a copy P2P. */

export interface VideoStat {
  url: string;
  title: string;
  site: string;
  views: number;
  seconds: number;
  last: number;
}

export interface Stats {
  since: number;
  totalSec: number;
  /** Seconds spent in rooms per local day (YYYY-MM-DD). */
  days: Record<string, number>;
  longestSec: number;
  largestRoom: number;
  hosted: number;
  sessions: number;
  videos: Record<string, VideoStat>;
  /** Seconds per site (YouTube, VK, …). */
  sites: Record<string, number>;
}

const KEY = 'watchlink:stats';
const MAX_VIDEOS = 60;

export function emptyStats(): Stats {
  return {
    since: Date.now(),
    totalSec: 0,
    days: {},
    longestSec: 0,
    largestRoom: 0,
    hosted: 0,
    sessions: 0,
    videos: {},
    sites: {},
  };
}

export function loadStats(): Stats {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw === 'object') return { ...emptyStats(), ...raw };
  } catch {}
  return emptyStats();
}

function saveStats(stats: Stats): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {}
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function siteOf(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'YouTube';
    if (/(^|\.)(vk\.com|vkvideo\.ru)$/.test(host)) return 'VK';
    if (host === 'drive.google.com') return 'Google Drive';
    return host;
  } catch {
    return '?';
  }
}

/** Videos ordered by how much they were watched, then by recency. */
export function topVideos(stats: Stats): VideoStat[] {
  return Object.values(stats.videos).sort((a, b) => b.views - a.views || b.last - a.last);
}
export function recentVideos(stats: Stats): VideoStat[] {
  return Object.values(stats.videos).sort((a, b) => b.last - a.last);
}

/** Accumulates time spent in a room while it is open. */
export class StatsTracker {
  private stats: Stats = loadStats();
  private active = false;
  private lastTick = 0;
  private sessionSec = 0;
  private url = '';
  private lastSave = 0;

  constructor(private onChange: (stats: Stats) => void) {}

  get snapshot(): Stats {
    return this.stats;
  }

  start(isHost: boolean): void {
    this.stop();
    this.active = true;
    this.lastTick = Date.now();
    this.sessionSec = 0;
    this.url = '';
    this.stats.sessions += 1;
    if (isHost) this.stats.hosted += 1;
    this.flush();
  }

  tick(peerCount: number): void {
    if (!this.active) return;
    const now = Date.now();
    // Clamp so a suspended app does not count the whole sleep as watch time.
    const dt = Math.min(2, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    const s = this.stats;
    s.totalSec += dt;
    this.sessionSec += dt;
    s.days[dayKey(now)] = (s.days[dayKey(now)] ?? 0) + dt;
    if (this.sessionSec > s.longestSec) s.longestSec = this.sessionSec;
    if (peerCount > s.largestRoom) s.largestRoom = peerCount;
    const video = this.url ? s.videos[this.url] : undefined;
    if (video) {
      video.seconds += dt;
      video.last = now;
      s.sites[video.site] = (s.sites[video.site] ?? 0) + dt;
    }
    if (now - this.lastSave > 15000) this.flush();
  }

  setVideo(url: string, title = ''): void {
    if (!this.active || !url) return;
    const s = this.stats;
    const known = s.videos[url];
    if (known) {
      if (title) known.title = title;
      if (this.url !== url) known.views += 1;
      known.last = Date.now();
    } else {
      s.videos[url] = { url, title, site: siteOf(url), views: 1, seconds: 0, last: Date.now() };
      const all = Object.values(s.videos);
      if (all.length > MAX_VIDEOS) {
        all.sort((a, b) => a.last - b.last);
        for (const old of all.slice(0, all.length - MAX_VIDEOS)) delete s.videos[old.url];
      }
    }
    this.url = url;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.flush();
  }

  private flush(): void {
    this.lastSave = Date.now();
    saveStats(this.stats);
    this.onChange({ ...this.stats });
  }
}
