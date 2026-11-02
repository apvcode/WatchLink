import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { T } from '../i18n.js';
import { DriveLogo, Icon, Logo } from '../icons.js';
import { recentVideos } from '../stats.js';
import type { AppState } from '../types.js';
import { Avatar } from './Avatar.js';
import { FriendsCard } from './FriendsUi.js';
import { VideoCard } from './ProfileScreen.js';

export function Home({
  state,
  t,
  onCreate,
  onJoin,
  onOpenDrive,
  onOpenProfile,
  onOpenSettings,
  onAddFriend,
  onOpenFriend,
}: {
  state: AppState;
  t: T;
  onCreate: (url: string) => void;
  onJoin: (invite: string) => void;
  onOpenDrive: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onAddFriend: () => void;
  onOpenFriend: (pub: string) => void;
}): JSX.Element {
  const [video, setVideo] = useState('');
  const [invite, setInvite] = useState('');
  const [joining, setJoining] = useState(false);
  const recent = recentVideos(state.stats).slice(0, 8);
  const { profile } = state;

  return (
    <div class="home">
      <div class="home-scroll">
        <div class="home-col">
          <header class="home-bar">
            <div class="home-brand" data-splash-target>
              <Logo size={32} />
              <span>WatchLink</span>
            </div>
            <div class="home-top-actions">
              <button
                type="button"
                class="icon-btn"
                onClick={onOpenSettings}
                aria-label={t('settings')}
                title={t('settings')}
              >
                <Icon name="settings" />
              </button>
              <button
                type="button"
                class="home-me"
                onClick={onOpenProfile}
                aria-label={t('profile')}
                title={t('profile')}
              >
                <Avatar name={profile.name} avatar={profile.avatar} size={44} />
              </button>
            </div>
          </header>

          <section class="hero">
            <p class="hero-hi">{t('hello', { name: profile.name })}</p>
            <h1>{t('startRoom')}</h1>
            <div class="svc-row" role="group">
              <button type="button" class="svc on" aria-pressed="true">
                <Icon name="link" size={16} />
                {t('svcLink')}
              </button>
              <button
                type="button"
                class="svc"
                style={{ viewTransitionName: 'drive-chip' }}
                onClick={onOpenDrive}
              >
                <DriveLogo size={16} />
                {t('svcDrive')}
              </button>
            </div>
            <form
              class="hero-form"
              onSubmit={(e) => {
                e.preventDefault();
                onCreate(video.trim());
              }}
            >
              <input
                value={video}
                placeholder={t('pasteLink')}
                onInput={(e) => setVideo((e.currentTarget as HTMLInputElement).value)}
              />
              <button type="submit" class="btn btn-primary">
                <Icon name="play" size={18} />
                {t('createRoom')}
              </button>
            </form>
            <button
              type="button"
              class="link-btn"
              aria-expanded={joining}
              onClick={() => setJoining(!joining)}
            >
              <Icon name="link" size={16} />
              {t('joinByInvite')}
            </button>
            {joining && (
              <form
                class="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (invite.trim()) onJoin(invite.trim());
                }}
              >
                <input
                  value={invite}
                  placeholder={t('invitePh')}
                  autoFocus
                  onInput={(e) => setInvite((e.currentTarget as HTMLInputElement).value)}
                />
                <button type="submit" class="btn">
                  <Icon name="users" size={18} />
                  {t('join')}
                </button>
              </form>
            )}
          </section>

          <FriendsCard
            friends={state.friends}
            t={t}
            onAdd={onAddFriend}
            onOpen={onOpenFriend}
            onJoin={onJoin}
          />

          <section class="recent">
            <h2>{t('recent')}</h2>
            {recent.length === 0 ? (
              <p class="empty">{t('noVideosYet')}</p>
            ) : (
              <div class="recent-row">
                {recent.map((v) => (
                  <VideoCard key={v.url} video={v} t={t} onClick={() => onCreate(v.url)} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
