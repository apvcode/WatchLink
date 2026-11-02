import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { fmtDate, fmtDuration } from '../format.js';
import type { T } from '../i18n.js';
import { Icon, type IconName } from '../icons.js';
import { youtubeId } from '../profile.js';
import { dayKey, recentVideos, type Stats, topVideos, type VideoStat } from '../stats.js';
import { Avatar } from './Avatar.js';

const DAYS = 30;
const SITE_COLORS = ['#ffffff', '#d0d0d0', '#a0a0a0', '#767676', '#545454', '#383838'];

export function ProfileScreen({
  name,
  avatar,
  handle,
  stats,
  language,
  t,
  onBack,
  onWatch,
  actions,
  status,
}: {
  name: string;
  avatar?: string;
  handle: string;
  stats: Stats;
  language: string;
  t: T;
  onBack: () => void;
  onWatch: (url: string) => void;
  /** Buttons shown in the top bar (edit profile, remove friend, …). */
  actions?: JSX.Element | null;
  status?: string;
}): JSX.Element {
  const [tab, setTab] = useState<'top' | 'history'>('top');

  const videos = (tab === 'top' ? topVideos(stats) : recentVideos(stats)).slice(0, 12);

  return (
    <div class="profile-screen">
      <div class="profile-scroll">
        <div class="profile-bar">
          <button type="button" class="icon-btn" onClick={onBack} aria-label={t('back')}>
            <Icon name="chevronLeft" />
          </button>
          <div class="profile-actions">{actions}</div>
        </div>
        <div class="profile-wrap">
          <header class="profile-head">
            <div class="profile-ava">
              <Avatar name={name} avatar={avatar} size={104} />
            </div>
            <h1>{name}</h1>
            <p class="profile-handle tabular">@{handle}</p>
            {status && <p class="profile-status">{status}</p>}
          </header>

          <Section icon="gauge" title={t('stats')}>
            <Row icon="users" label={t('joinDate')} value={fmtDate(stats.since, language)} />
            <Row icon="play" label={t('watchTime')} value={fmtDuration(stats.totalSec, t)} />
            <Row icon="monitor" label={t('sessionsCount')} value={String(stats.sessions)} />
            <Row icon="crown" label={t('hostedRooms')} value={String(stats.hosted)} />
            <Row
              icon="refresh"
              label={t('longestSession')}
              value={fmtDuration(stats.longestSec, t)}
            />
            <Row
              icon="users"
              label={t('largestRoom')}
              value={t('personN', { n: String(stats.largestRoom) })}
            />
            <DailyChart stats={stats} t={t} />
          </Section>

          <Section icon="play" title={t('videosTitle')}>
            <div class="seg">
              <button type="button" class={tab === 'top' ? 'on' : ''} onClick={() => setTab('top')}>
                {t('tabTop')}
              </button>
              <button
                type="button"
                class={tab === 'history' ? 'on' : ''}
                onClick={() => setTab('history')}
              >
                {t('tabHistory')}
              </button>
            </div>
            {videos.length === 0 ? (
              <p class="empty">{t('noVideosYet')}</p>
            ) : (
              <div class="video-grid">
                {videos.map((v) => (
                  <VideoCard key={v.url} video={v} t={t} onClick={() => onWatch(v.url)} />
                ))}
              </div>
            )}
          </Section>

          <Section icon="globe" title={t('interests')}>
            <Interests stats={stats} t={t} />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: JSX.Element | JSX.Element[];
}): JSX.Element {
  return (
    <section class="psec">
      <h2>
        <Icon name={icon} size={18} />
        {title}
      </h2>
      <div class="psec-body">{children}</div>
    </section>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div class="prow">
      <Icon name={icon} size={20} />
      <span>{label}</span>
      <b class="tabular">{value}</b>
    </div>
  );
}

function DailyChart({ stats, t }: { stats: Stats; t: T }): JSX.Element {
  const now = Date.now();
  const hours: number[] = [];
  for (let i = DAYS - 1; i >= 0; i--)
    hours.push((stats.days[dayKey(now - i * 86400000)] ?? 0) / 3600);
  const max = Math.max(1, Math.ceil(Math.max(...hours)));
  const W = 300;
  const H = 110;
  const bw = W / DAYS;
  return (
    <figure class="chart">
      <figcaption>{t('dailyHours')}</figcaption>
      <svg viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={t('dailyHours')}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1="0" x2={W} y1={H - f * H} y2={H - f * H} class="grid" />
            <text x="0" y={H - f * H - 3} class="axis">
              {Math.round(max * f * 10) / 10}
            </text>
          </g>
        ))}
        {hours.map((h, i) => (
          <rect
            key={i}
            style={{ '--i': i } as JSX.CSSProperties}
            x={i * bw + 1.5}
            width={bw - 3}
            y={H - (h / max) * H}
            height={Math.max(h > 0 ? 2 : 0, (h / max) * H)}
            rx="2"
            class="bar"
          />
        ))}
      </svg>
    </figure>
  );
}

function Interests({ stats, t }: { stats: Stats; t: T }): JSX.Element {
  const entries = Object.entries(stats.sites)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const total = entries.reduce((n, [, v]) => n + v, 0);
  if (!total) return <p class="empty">{t('noStatsYet')}</p>;
  const R = 60;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div class="donut">
      <svg viewBox="0 0 160 160" role="img" aria-label={t('interests')}>
        {entries.map(([site, v], i) => {
          const len = (v / total) * C;
          const seg = (
            <circle
              key={site}
              cx="80"
              cy="80"
              r={R}
              fill="none"
              stroke={SITE_COLORS[i % SITE_COLORS.length]}
              stroke-width="22"
              stroke-dasharray={`${Math.max(0, len - 1.5)} ${C}`}
              stroke-dashoffset={-offset}
              transform="rotate(-90 80 80)"
            />
          );
          offset += len;
          return seg;
        })}
        <text x="80" y="86" text-anchor="middle" class="donut-label">
          {t('sitesLabel')}
        </text>
      </svg>
      <ul>
        {entries.map(([site, v], i) => (
          <li key={site}>
            <i style={{ background: SITE_COLORS[i % SITE_COLORS.length] }} />
            <span>{site}</span>
            <b class="tabular">{Math.round((v / total) * 100)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function thumbFor(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}

export function VideoCard({
  video,
  t,
  onClick,
}: {
  video: VideoStat;
  t: T;
  onClick: () => void;
}): JSX.Element {
  const thumb = thumbFor(video.url);
  return (
    <button type="button" class="vcard" onClick={onClick} title={t('watchAgain')}>
      <div class="vthumb" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}>
        <span class="vsite">{video.site}</span>
      </div>
      <span class="vtitle">{video.title || video.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
      <span class="vmeta">{t('viewsN', { n: String(video.views) })}</span>
    </button>
  );
}
