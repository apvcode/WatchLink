import {
  derivePubId,
  type FriendsData,
  FriendsManager,
  type FriendsStorage,
  type SharedStats,
} from '@watchlink/core';
import { dayKey, loadStats, type Stats, topVideos } from './stats.js';
import type { Profile } from './types.js';

const KEY = 'watchlink:friends';

const storage: FriendsStorage = {
  load(): FriendsData {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (raw && Array.isArray(raw.friends))
        return {
          friends: raw.friends,
          incoming: Array.isArray(raw.incoming) ? raw.incoming : [],
          outgoing: Array.isArray(raw.outgoing) ? raw.outgoing : [],
        };
    } catch {}
    return { friends: [], incoming: [], outgoing: [] };
  },
  save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {}
  },
};

export function toShared(stats: Stats): SharedStats {
  const days: Record<string, number> = {};
  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    const k = dayKey(now - i * 86400000);
    if (stats.days[k]) days[k] = Math.round(stats.days[k]);
  }
  return {
    since: stats.since,
    totalSec: Math.round(stats.totalSec),
    longestSec: Math.round(stats.longestSec),
    largestRoom: stats.largestRoom,
    hosted: stats.hosted,
    sessions: stats.sessions,
    days,
    videos: topVideos(stats)
      .slice(0, 6)
      .map((v) => ({ url: v.url, title: v.title.slice(0, 100), site: v.site, views: v.views })),
    sites: Object.fromEntries(Object.entries(stats.sites).map(([k, v]) => [k, Math.round(v)])),
  };
}

export function fromShared(shared: SharedStats | undefined, since: number): Stats {
  if (!shared) return { ...loadEmpty(), since };
  return {
    since: shared.since || since,
    totalSec: shared.totalSec,
    days: shared.days,
    longestSec: shared.longestSec,
    largestRoom: shared.largestRoom,
    hosted: shared.hosted,
    sessions: shared.sessions,
    sites: shared.sites,
    videos: Object.fromEntries(
      shared.videos.map((v, i) => [
        v.url,
        { url: v.url, title: v.title, site: v.site, views: v.views, seconds: 0, last: -i },
      ]),
    ),
  };
}

function loadEmpty(): Stats {
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

export async function createFriends(profile: Profile): Promise<FriendsManager> {
  const pub = await derivePubId(profile.uid);
  return new FriendsManager({
    self: { pub, name: profile.name, avatar: profile.avatar },
    storage,
    getStats: () => toShared(loadStats()),
    relayUrls: import.meta.env.VITE_WATCHLINK_TEST_RELAY
      ? [import.meta.env.VITE_WATCHLINK_TEST_RELAY]
      : undefined,
    testOnlyLoopback: Boolean(import.meta.env.VITE_WATCHLINK_TEST_RELAY),
  });
}
