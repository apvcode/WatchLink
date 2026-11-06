import type { FriendsManager, FriendsSnapshot } from '@watchlink/core';
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { DrivePicker } from './components/DrivePicker.js';
import { FriendsSheet, InviteBanner, InviteSheet } from './components/FriendsUi.js';
import { Home } from './components/Home.js';
import { Onboarding } from './components/Onboarding.js';
import { ProfileScreen } from './components/ProfileScreen.js';
import { Room } from './components/Room.js';
import { RoomEntry } from './components/RoomEntry.js';
import { Screens } from './components/Screens.js';
import { SettingsScreen } from './components/SettingsScreen.js';
import {
  ConsentSheet,
  DebugOverlay,
  LeaveSheet,
  LinkSheet,
  ProfileSheet,
  Toast,
} from './components/Sheets.js';
import { createFriends, fromShared } from './friends.js';
import { host } from './host.js';
import { getInitialLanguage, type Key, type Language, makeT } from './i18n.js';
import { Icon } from './icons.js';
import { createProfile, loadProfile, saveProfile } from './profile.js';
import { loadAmbientPref, Session } from './session.js';
import { dayKey, loadStats, type Stats, type VideoStat } from './stats.js';
import { withTransition } from './transition.js';
import type { AppState, Profile } from './types.js';

const ERROR_KEYS: Key[] = ['cantConnect', 'roomFull', 'badInvite'];

const EMPTY_FRIENDS: FriendsSnapshot = { friends: [], incoming: [], outgoing: [], presence: {} };

function initialState(): AppState {
  const params = new URLSearchParams(window.location.search);
  const demo = params.get('demo') === '1' ? params.get('state') || 'room' : '';
  const stored = loadProfile();
  const profile: Profile = stored ?? { uid: '0'.repeat(32), name: '' };
  const base: AppState = {
    screen: stored ? 'home' : 'onboarding',
    language: (params.get('lang') as Language) || getInitialLanguage(),
    profile,
    stats: loadStats(),
    friends: EMPTY_FRIENDS,
    myPub: '',
    viewFriend: '',
    roomId: '',
    roomUrl: '',
    myPeerId: '',
    isHost: false,
    hostPeerId: '',
    peers: [],
    connection: 'offline',
    videoUrl: '',
    videoTitle: '',
    playerLoading: false,
    queue: [],
    ambient: null,
    ambientOn: loadAmbientPref(),
    playing: false,
    position: 0,
    duration: 0,
    rate: 1,
    buffering: false,
    adPlaying: false,
    qualities: [],
    quality: 'auto',
    qualityActual: '',
    audioTracks: [],
    audioTrack: '',
    captionTracks: [],
    captionTrack: 'off',
    caption: '',
    syncState: 'offline',
    lamportTime: 0,
    medianRttMs: 0,
    chatMessages: [],
    unread: 0,
    activeTab: 'chat',
    isPanelOpen: true,
    sheet: 'none',
    isFullscreen: false,
    isConsentOpen: false,
    consentUrl: '',
    isDebugOverlay: params.get('debug') === 'true',
    noVideoFound: false,
    bufferingPeerName: null,
    errorMessage: null,
  };
  if (!demo) return base;
  const now = Date.now();
  return {
    ...base,
    screen:
      demo === 'home' || demo === 'friends'
        ? 'home'
        : demo === 'profile'
          ? 'profile'
          : demo === 'settings'
            ? 'settings'
            : demo === 'onboarding'
              ? 'onboarding'
              : 'room',
    profile: { uid: 'a'.repeat(32), name: 'Alex' },
    stats: demoStats(now),
    friends: {
      friends: [
        { pub: 'b'.repeat(32), name: 'Sarah', secret: 'c'.repeat(32), since: now },
        { pub: 'd'.repeat(32), name: 'Дмитрий', secret: 'c'.repeat(32), since: now },
        { pub: 'e'.repeat(32), name: 'Kate', secret: 'c'.repeat(32), since: now },
      ],
      incoming: [{ pub: 'f'.repeat(32), name: 'Nick', at: now }],
      outgoing: [],
      presence: {
        ['b'.repeat(32)]: {
          online: true,
          status: 'watching',
          invite: { code: 'wl://join#roomId=x&secret=12345678', title: 'Big Buck Bunny', at: now },
        },
        ['d'.repeat(32)]: { online: true, status: 'idle' },
      },
    },
    myPub: 'a'.repeat(32),
    roomId: 'f3a9c1d27b',
    roomUrl: 'wl://join#roomId=f3a9c1d27b&secret=demo',
    myPeerId: 'me',
    isHost: true,
    hostPeerId: 'me',
    connection: 'connected',
    syncState: 'sync',
    medianRttMs: 42,
    peers: [
      { id: 'p1', name: 'Sarah', isHost: false, isBuffering: false },
      { id: 'p2', name: 'Дмитрий', isHost: false, isBuffering: false },
    ],
    videoUrl: demo === 'waiting' ? '' : 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    videoTitle: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film',
    duration: demo === 'loading' ? 0 : 596,
    position: 124,
    playing: demo !== 'paused',
    qualities: ['hd1080', 'hd720', 'large', 'medium'],
    qualityActual: 'hd1080',
    chatMessages: [
      {
        id: '1',
        senderId: 'p1',
        senderName: 'Sarah',
        text: '',
        sys: 'joined',
        timestamp: now,
        isSystem: true,
      },
      {
        id: '2',
        senderId: 'p1',
        senderName: 'Sarah',
        text: 'Hey! Ready when you are 🍿',
        timestamp: now,
      },
      {
        id: '3',
        senderId: 'me',
        senderName: 'Alex',
        text: 'Starting now, everything is in sync',
        timestamp: now,
        isSelf: true,
      },
      { id: '4', senderId: 'p2', senderName: 'Дмитрий', text: 'Качество огонь', timestamp: now },
    ],
    sheet: demo === 'friends' ? 'friends' : 'none',
  };
}

function demoStats(now: number): Stats {
  const days: Record<string, number> = {};
  for (let i = 0; i < 30; i++) days[dayKey(now - i * 86400000)] = ((i * 7919) % 11) * 900;
  const v = (url: string, title: string, views: number, site: string): [string, VideoStat] => [
    url,
    { url, title, site, views, seconds: views * 1200, last: now - views * 3600000 },
  ];
  return {
    since: now - 40 * 86400000,
    totalSec: 38 * 3600,
    days,
    longestSec: 6 * 3600,
    largestRoom: 4,
    hosted: 12,
    sessions: 31,
    videos: Object.fromEntries([
      v('https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'Big Buck Bunny 60fps 4K', 5, 'YouTube'),
      v('https://www.youtube.com/watch?v=YE7VzlLtp-4', 'Big Buck Bunny', 3, 'YouTube'),
      v('https://vkvideo.ru/video-220754053_456241022', 'Злодей Грю', 2, 'VK'),
    ]),
    sites: { YouTube: 50000, VK: 20000, 'Google Drive': 30000 },
  };
}

export function App(): JSX.Element {
  const [state, setState] = useState<AppState>(initialState);
  const sessionRef = useRef<Session | null>(null);
  if (!sessionRef.current)
    sessionRef.current = new Session(setState, (stats) => setState((s) => ({ ...s, stats })));
  const session = sessionRef.current;
  const t = makeT(state.language);
  const stateRef = useRef(state);
  stateRef.current = state;
  const patch = (p: Partial<AppState>) => setState((s) => ({ ...s, ...p }));

  useEffect(() => () => session.close(), []);

  // Friends: one manager per identity, alive while the app is open.
  const friendsRef = useRef<FriendsManager | null>(null);
  const [invitedPubs, setInvitedPubs] = useState<string[]>([]);
  const uid = state.profile.uid;
  const hasProfile = Boolean(state.profile.name);
  const demoMode = new URLSearchParams(window.location.search).get('demo') === '1';
  useEffect(() => {
    if (!hasProfile || demoMode) return;
    let stop = () => {};
    let alive = true;
    void createFriends(stateRef.current.profile).then((manager) => {
      if (!alive) return;
      friendsRef.current = manager;
      const off = manager.subscribe((friends) => setState((s) => ({ ...s, friends })));
      patch({ myPub: manager.pub });
      manager.start();
      stop = () => {
        off();
        manager.stop();
      };
    });
    return () => {
      alive = false;
      friendsRef.current = null;
      stop();
    };
  }, [uid, hasProfile]);
  useEffect(() => {
    friendsRef.current?.setStatus(state.screen === 'room' ? 'watching' : 'idle');
  }, [state.screen, state.myPub]);
  const lastBack = useRef(0);
  const pendingJoin = useRef('');
  const [exitHint, setExitHint] = useState(false);
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  const settingsReturn = useRef<'home' | 'room'>('home');
  const openSettings = () => {
    settingsReturn.current = stateRef.current.screen === 'room' ? 'room' : 'home';
    patch({ screen: 'settings', sheet: 'none' });
  };
  const closeSettings = () => patch({ screen: settingsReturn.current });

  // Play the entry animation whenever we move into a room.
  const [entry, setEntry] = useState<'create' | 'join' | 'leave' | null>(null);
  const prevScreen = useRef(state.screen);
  // Layout effect so the overlay mounts before the new screen is ever painted.
  useLayoutEffect(() => {
    if (prevScreen.current !== 'room' && state.screen === 'room')
      setEntry(stateRef.current.isHost ? 'create' : 'join');
    else if (prevScreen.current === 'room' && state.screen === 'home') setEntry('leave');
    prevScreen.current = state.screen;
  }, [state.screen]);
  useEffect(() => {
    try {
      localStorage.setItem('watchlink:language', state.language);
    } catch {}
    document.documentElement.lang = state.language;
  }, [state.language]);

  // Tell the native shell where the video goes (the stage is a hole in this page).
  useEffect(() => {
    const send = () => {
      const area = document.getElementById('watchlink-content-view-area');
      const r = area?.getBoundingClientRect();
      host.send({
        type: 'bounds',
        rect:
          state.screen === 'room' && state.videoUrl && r && r.width > 0
            ? { x: r.x, y: r.y, width: r.width, height: r.height }
            : null,
        hidden: state.noVideoFound || Boolean(state.errorMessage),
      });
    };
    const frame = requestAnimationFrame(send);
    const late = setTimeout(send, 250);
    const area = document.getElementById('watchlink-content-view-area');
    const observer = area ? new ResizeObserver(send) : null;
    if (area) observer?.observe(area);
    window.addEventListener('resize', send);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(late);
      observer?.disconnect();
      window.removeEventListener('resize', send);
    };
  }, [
    state.screen,
    state.videoUrl,
    state.isPanelOpen,
    state.isFullscreen,
    state.noVideoFound,
    state.errorMessage,
  ]);

  const leave = () => {
    session.close();
    friendsRef.current?.withdrawInvites();
    friendsRef.current?.shareStats();
    setInvitedPubs([]);
    if (stateRef.current.isFullscreen) host.send({ type: 'fullscreen', on: false });
    patch({
      screen: 'home',
      isFullscreen: false,
      sheet: 'none',
      bufferingPeerName: null,
      errorMessage: null,
      noVideoFound: false,
      videoUrl: '',
    });
  };
  const setFullscreen = (on: boolean) => {
    host.send({ type: 'fullscreen', on });
    patch({ isFullscreen: on });
  };
  const fail = (error: Error) => patch({ errorMessage: error.message });
  const create = (url: string) => {
    void session.open(stateRef.current.profile, url).catch(fail);
  };
  const join = (invite: string) => {
    void session.open(stateRef.current.profile, '', invite).catch(fail);
  };

  useEffect(
    () =>
      host.subscribe((data) => {
        if (data.type === 'watchlink:host:join') {
          // The profile may not exist yet (onboarding): keep the invite until it does.
          if (stateRef.current.profile.name) join(String(data.roomCode));
          else pendingJoin.current = String(data.roomCode);
        }
        if (data.type === 'watchlink:host:back') {
          const s = stateRef.current;
          if (s.sheet !== 'none') patch({ sheet: 'none' });
          else if (s.isFullscreen) setFullscreen(false);
          else if (s.screen === 'room') patch({ sheet: 'leaveRoom' });
          else if (s.screen === 'drive') withTransition(() => patch({ screen: 'home' }));
          else if (s.screen === 'settings') closeSettings();
          else if (s.screen === 'profile' || s.screen === 'friend') patch({ screen: 'home' });
          else if (Date.now() - lastBack.current < 2000) host.send({ type: 'exit' });
          else {
            // First press on the root screen only warns; a second one within 2 s exits.
            lastBack.current = Date.now();
            setExitHint(true);
            setTimeout(() => setExitHint(false), 2000);
          }
        }
      }),
    [],
  );
  useEffect(() => {
    // Tell the host that the listener above is live so it can deliver a pending wl:// invite.
    host.send({ type: 'ready' });
  }, []);
  useEffect(() => {
    if (pendingJoin.current && state.profile.name) {
      const invite = pendingJoin.current;
      pendingJoin.current = '';
      join(invite);
    }
  }, [state.profile.name]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const s = stateRef.current;
      if (s.sheet !== 'none') patch({ sheet: 'none' });
      else if (s.screen === 'settings') closeSettings();
      else if (s.isFullscreen) setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const saveMe = (name: string, avatar: string | undefined) => {
    const current = stateRef.current.profile;
    const profile: Profile = current.name
      ? { ...current, name, avatar }
      : createProfile(name, avatar);
    saveProfile(profile);
    session.updateProfile(profile.name, profile.avatar);
    friendsRef.current?.updateSelf({ name: profile.name, avatar: profile.avatar });
    setState((s) => ({ ...s, profile, screen: s.screen === 'onboarding' ? 'home' : s.screen }));
  };

  const errorText = state.errorMessage
    ? (ERROR_KEYS as string[]).includes(state.errorMessage)
      ? t(state.errorMessage as Key)
      : state.errorMessage
    : '';

  const copyInvite = () => {
    host.send({ type: 'copy', text: state.roomUrl });
    if (!window.watchlinkHost && !window.WatchLinkHost)
      void navigator.clipboard?.writeText(state.roomUrl).catch(() => {});
  };

  let body: JSX.Element;
  if (state.screen === 'onboarding')
    body = (
      <Onboarding
        t={t}
        language={state.language}
        onLanguage={(language) => patch({ language })}
        onDone={saveMe}
      />
    );
  else if (state.screen === 'home')
    body = (
      <Home
        state={state}
        t={t}
        onCreate={create}
        onJoin={join}
        onOpenDrive={() => withTransition(() => patch({ screen: 'drive' }))}
        onOpenProfile={() => patch({ screen: 'profile' })}
        onOpenSettings={openSettings}
        onAddFriend={() => patch({ sheet: 'friends' })}
        onOpenFriend={(pub) => patch({ screen: 'friend', viewFriend: pub })}
      />
    );
  else if (state.screen === 'drive')
    body = (
      <DrivePicker
        t={t}
        onBack={() => withTransition(() => patch({ screen: 'home' }))}
        onPick={create}
      />
    );
  else if (state.screen === 'settings')
    body = (
      <SettingsScreen
        state={state}
        t={t}
        onBack={closeSettings}
        onLanguage={(language) => patch({ language })}
        onToggleDebug={() => patch({ isDebugOverlay: !state.isDebugOverlay })}
        onToggleAmbient={() => session.setAmbient(!state.ambientOn)}
        onProfile={saveMe}
      />
    );
  else if (state.screen === 'profile')
    body = (
      <ProfileScreen
        name={state.profile.name}
        avatar={state.profile.avatar}
        handle={state.myPub.slice(0, 8) || state.profile.uid.slice(0, 8)}
        stats={state.stats}
        language={state.language}
        t={t}
        onBack={() => patch({ screen: 'home' })}
        onWatch={create}
        actions={
          <button type="button" class="btn btn-sm" onClick={() => patch({ sheet: 'profile' })}>
            <Icon name="user" size={16} />
            {t('editProfile')}
          </button>
        }
      />
    );
  else if (state.screen === 'friend') {
    const friend = state.friends.friends.find((f) => f.pub === state.viewFriend);
    const presence = state.friends.presence[state.viewFriend];
    body = friend ? (
      <ProfileScreen
        name={friend.name}
        avatar={friend.avatar}
        handle={friend.pub.slice(0, 8)}
        stats={fromShared(friend.stats, friend.since)}
        language={state.language}
        t={t}
        status={
          presence?.online
            ? presence.status === 'watching'
              ? t('watchingNow')
              : t('online')
            : t('offline')
        }
        onBack={() => patch({ screen: 'home' })}
        onWatch={create}
        actions={
          <>
            {presence?.invite && (
              <button
                type="button"
                class="btn btn-sm btn-primary"
                onClick={() => join(presence.invite?.code ?? '')}
              >
                {t('joinNow')}
              </button>
            )}
            <button
              type="button"
              class="btn btn-sm"
              onClick={() => {
                friendsRef.current?.remove(friend.pub);
                patch({ screen: 'home' });
              }}
            >
              {t('removeFriend')}
            </button>
          </>
        }
      />
    ) : (
      <div />
    );
  } else
    body = (
      <Room
        state={state}
        t={t}
        actions={{
          onTogglePanel: () => patch({ isPanelOpen: !state.isPanelOpen, unread: 0 }),
          onTab: (activeTab) =>
            patch({ activeTab, unread: activeTab === 'chat' ? 0 : state.unread }),
          onOpenSettings: () => openSettings(),
          onOpenLink: () => patch({ sheet: 'link' }),
          onInviteFriends: () => patch({ sheet: 'invite' }),
          onNext: () => session.playNext(),
          onLeave: leave,
          onSend: (text) => session.room?.sendChat(text),
          onSendImage: (b64) => void session.room?.sendImage(b64),
          onHandover: (id) => session.room?.syncEngine.handover(id),
          onCopyInvite: copyInvite,
          onCommand: (action, value) => {
            const engine = session.room?.syncEngine;
            if (!engine) return;
            engine.command(
              action,
              action === 'seek' ? value : state.position,
              action === 'rate' ? value : engine.getRoomState().rate,
            );
          },
          onQuality: (q) => session.setQuality(q),
          onAudio: (track) => session.setAudio(track),
          onCaptions: (id) => session.setCaptions(id),
          onFullscreen: () => setFullscreen(!state.isFullscreen),
          onReload: () => {
            patch({ noVideoFound: false });
            session.reload();
          },
          onLinkDrive: () => openSettings(),
        }}
      />
    );

  return (
    <>
      <Screens
        id={state.screen === 'friend' ? `friend:${state.viewFriend}` : state.screen}
        depth={
          state.screen === 'room' || state.screen === 'settings'
            ? 2
            : state.screen === 'profile' || state.screen === 'friend'
              ? 1
              : 0
        }
        animate={
          state.screen === 'home' ||
          state.screen === 'profile' ||
          state.screen === 'friend' ||
          state.screen === 'settings'
        }
      >
        {body}
      </Screens>
      {state.sheet === 'profile' && (
        <ProfileSheet
          state={state}
          t={t}
          onClose={() => patch({ sheet: 'none' })}
          onProfile={saveMe}
        />
      )}
      {state.sheet === 'friends' && (
        <FriendsSheet
          t={t}
          friends={state.friends}
          myPub={state.myPub}
          onClose={() => patch({ sheet: 'none' })}
          onRequest={(code) => friendsRef.current?.sendRequest(code) ?? 'invalid'}
          onAccept={(pub) => void friendsRef.current?.accept(pub)}
          onDecline={(pub) => friendsRef.current?.decline(pub)}
          onCancel={(pub) => friendsRef.current?.cancelRequest(pub)}
          onCopy={(text) => {
            host.send({ type: 'copy', text });
            if (!window.watchlinkHost && !window.WatchLinkHost)
              void navigator.clipboard?.writeText(text).catch(() => {});
          }}
        />
      )}
      {state.sheet === 'invite' && (
        <InviteSheet
          t={t}
          friends={state.friends}
          invited={invitedPubs}
          onClose={() => patch({ sheet: 'none' })}
          onInvite={(pub) => {
            friendsRef.current?.invite([pub], state.roomUrl, state.videoTitle);
            setInvitedPubs((l) => [...l, pub]);
          }}
        />
      )}
      {state.sheet === 'leaveRoom' && (
        <LeaveSheet
          t={t}
          onStay={() => patch({ sheet: 'none' })}
          onLeave={() => {
            patch({ sheet: 'none' });
            leave();
          }}
        />
      )}
      {exitHint && <div class="exit-hint">{t('exitHint')}</div>}
      {state.sheet === 'link' && (
        <LinkSheet
          t={t}
          queue={state.queue}
          onQueue={(url) => {
            try {
              session.addToQueue(url);
            } catch (e) {
              fail(e as Error);
            }
          }}
          onRemove={(id) => session.removeFromQueue(id)}
          onPlayNow={(id) => session.playNext(id)}
          onClose={() => patch({ sheet: 'none' })}
          onSubmit={(url) => {
            try {
              session.changeVideo(url);
            } catch (e) {
              fail(e as Error);
            }
          }}
        />
      )}
      {state.isConsentOpen && (
        <ConsentSheet
          t={t}
          url={state.consentUrl}
          onConfirm={() => {
            session.approve(state.consentUrl);
            patch({ isConsentOpen: false });
          }}
          onCancel={() => {
            session.reject();
            patch({ isConsentOpen: false });
          }}
        />
      )}
      {state.screen !== 'room' &&
        state.screen !== 'onboarding' &&
        state.friends.friends.map((f) => {
          const inv = state.friends.presence[f.pub]?.invite;
          if (!inv || dismissed[f.pub] === inv.at) return null;
          return (
            <InviteBanner
              key={f.pub}
              t={t}
              name={f.name}
              avatar={f.avatar}
              title={inv.title}
              onJoin={() => {
                friendsRef.current?.dismissInvite(f.pub);
                join(inv.code);
              }}
              onDismiss={() => setDismissed((d) => ({ ...d, [f.pub]: inv.at }))}
            />
          );
        })}
      {errorText && (
        <Toast
          message={errorText}
          t={t}
          onRetry={state.screen === 'room' && state.videoUrl ? () => session.reload() : undefined}
          onDismiss={() => patch({ errorMessage: null })}
        />
      )}
      {state.isDebugOverlay && state.screen === 'room' && <DebugOverlay state={state} />}
      {entry && (
        <RoomEntry
          mode={entry}
          roomId={state.roomId}
          label={t(
            entry === 'create' ? 'creatingRoom' : entry === 'join' ? 'joiningRoom' : 'leavingRoom',
          )}
          ready={
            entry === 'leave' ||
            entry === 'create' ||
            state.connection === 'connected' ||
            state.connection === 'error' ||
            state.connection === 'full'
          }
          failed={entry === 'join' && (state.connection === 'error' || state.connection === 'full')}
          failLabel={t('roomNotFound')}
          failHint={t('roomNotFoundHint')}
          onFail={() => {
            session.close();
            friendsRef.current?.withdrawInvites();
            patch({ screen: 'home', isFullscreen: false, sheet: 'none', videoUrl: '' });
            prevScreen.current = 'home';
          }}
          onDone={() => setEntry(null)}
        />
      )}
    </>
  );
}
