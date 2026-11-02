import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { qualityLabel, type T } from '../i18n.js';
import { Icon } from '../icons.js';
import { youtubeId } from '../profile.js';
import type { AppState } from '../types.js';
import { Avatar } from './Avatar.js';
import { ChatTicker } from './ChatTicker.js';

export type PlayerCommand = 'play' | 'pause' | 'seek' | 'rate';
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function clock(value: number): string {
  const s = Math.max(0, Math.floor(value || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

type MenuView = 'none' | 'main' | 'speed' | 'quality' | 'audio' | 'captions';

export function Stage({
  state,
  t,
  onCommand,
  onQuality,
  onAudio,
  onCaptions,
  onFullscreen,
  onAddVideo,
  onReload,
}: {
  state: AppState;
  t: T;
  onCommand: (action: PlayerCommand, value?: number) => void;
  onQuality: (quality: string) => void;
  onAudio: (track: { id: string; label: string }) => void;
  onCaptions: (id: string) => void;
  onFullscreen: () => void;
  onAddVideo: () => void;
  onReload: () => void;
}): JSX.Element {
  const [idle, setIdle] = useState(false);
  const [menu, setMenu] = useState<MenuView>('none');
  const [drag, setDrag] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const ready = Boolean(state.videoUrl) && state.duration > 0 && !state.playerLoading;
  const wake = () => {
    setIdle(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), 3200);
  };
  useEffect(() => {
    if (!state.playing || menu !== 'none' || !ready) {
      clearTimeout(timer.current);
      setIdle(false);
    } else wake();
    return () => clearTimeout(timer.current);
  }, [state.playing, menu, ready]);

  const shown = drag ?? state.position;
  const pct = state.duration ? Math.min(100, (shown / state.duration) * 100) : 0;
  const yt = youtubeId(state.videoUrl);
  const poster = yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : undefined;
  const title = state.videoTitle || host(state.videoUrl);
  const hostPeer = state.peers.find((p) => p.isHost);
  const hostName = state.isHost ? state.profile.name : (hostPeer?.name ?? '');
  const seekBy = (delta: number) =>
    onCommand('seek', Math.max(0, Math.min(state.duration || 0, state.position + delta)));

  let posterNode: JSX.Element | null = null;
  if (!state.videoUrl)
    posterNode = (
      <div class="poster">
        <div class="poster-msg">
          <h3>{t('waitingTitle')}</h3>
          <p>{t('waitingSub')}</p>
          <button type="button" class="btn btn-primary" onClick={onAddVideo}>
            <Icon name="link" size={18} />
            {t('addVideo')}
          </button>
        </div>
      </div>
    );
  else if (state.noVideoFound)
    posterNode = (
      <div class="poster">
        <div class="poster-msg">
          <Icon name="alert" size={34} />
          <h3>{t('noVideoTitle')}</h3>
          <p>{t('noVideoSub')}</p>
          <button type="button" class="btn" onClick={onReload}>
            <Icon name="refresh" size={16} />
            {t('reload')}
          </button>
        </div>
      </div>
    );
  else if (!ready)
    posterNode = (
      <div class="poster">
        {poster && <div class="bg" style={{ backgroundImage: `url(${poster})` }} />}
        <div class="poster-msg">
          <div class="spinner" />
          <p>{t('loading')}</p>
        </div>
      </div>
    );

  return (
    <div
      id="watchlink-content-view-area"
      class={`stage${idle ? ' idle' : ''}${state.playing ? ' playing' : ''}${state.isFullscreen ? ' fs' : ''}`}
      onPointerMove={wake}
      onPointerDown={wake}
    >
      {posterNode}
      {state.isFullscreen && <ChatTicker messages={state.chatMessages} />}

      {ready && (
        <div class="overlay">
          <div class="ov-top">
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                class="pill"
                disabled={!state.isHost}
                onClick={() => setMenu('speed')}
                aria-label={t('speed')}
              >
                {Math.round(state.rate * 100) / 100}x
              </button>
            </div>
            <button
              type="button"
              class="icon-btn"
              style={{ background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(18px)' }}
              onClick={() => setMenu('main')}
              aria-label={t('settings')}
              title={t('settings')}
            >
              <Icon name="settings" />
            </button>
          </div>

          <div class="ov-center">
            <button
              type="button"
              class="skip"
              disabled={!state.isHost}
              onClick={() => seekBy(-10)}
              aria-label="-10s"
            >
              <Icon name="back10" size={28} stroke={1.8} />
            </button>
            <button
              type="button"
              class="big-play"
              disabled={!state.isHost}
              aria-label={state.playing ? t('pause') : t('play')}
              onClick={() => onCommand(state.playing ? 'pause' : 'play')}
            >
              <Icon name={state.playing ? 'pause' : 'play'} size={34} />
            </button>
            <button
              type="button"
              class="skip fwd"
              disabled={!state.isHost}
              onClick={() => seekBy(10)}
              aria-label="+10s"
            >
              <Icon name="fwd10" size={28} stroke={1.8} />
            </button>
          </div>

          <div class="ov-bottom">
            <div class="meta">
              <Avatar
                name={hostName || '?'}
                avatar={state.isHost ? state.profile.avatar : hostPeer?.avatar}
                size={34}
              />
              <div class="titles">
                <div class="t">{title}</div>
                <div class="s">{host(state.videoUrl)}</div>
              </div>
              <button
                type="button"
                class="icon-btn"
                style={{ background: 'transparent' }}
                onClick={onFullscreen}
                aria-label={state.isFullscreen ? t('exitFullscreen') : t('fullscreen')}
                title={state.isFullscreen ? t('exitFullscreen') : t('fullscreen')}
              >
                <Icon name={state.isFullscreen ? 'minimize' : 'maximize'} />
              </button>
            </div>
            <div class="seek-row">
              <span class="tabular">{clock(shown)}</span>
              <input
                class="seek"
                type="range"
                disabled={!state.isHost}
                aria-label="Seek"
                min="0"
                max={state.duration || 1}
                step="0.1"
                value={shown}
                style={{ '--p': `${pct}%` } as JSX.CSSProperties}
                onInput={(e) => setDrag(Number((e.currentTarget as HTMLInputElement).value))}
                onChange={(e) => {
                  onCommand('seek', Number((e.currentTarget as HTMLInputElement).value));
                  setDrag(null);
                }}
              />
              <span class="tabular">{clock(state.duration)}</span>
            </div>
          </div>
        </div>
      )}

      {ready && state.caption && state.captionTrack !== 'off' && (
        <div class={`subs${idle || !state.playing ? ' low' : ''}`} aria-live="off">
          {state.caption.split('\n').map((line, i) => (
            <div key={`${i}-${line}`}>
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}

      {state.adPlaying && (
        <div class="banner">
          <div class="spinner" />
          {t('ad')}
        </div>
      )}
      {!state.adPlaying && state.bufferingPeerName && (
        <div class="banner">
          <div class="spinner" />
          {t('holding', { name: state.bufferingPeerName })}
        </div>
      )}

      {menu !== 'none' && (
        <div
          class="menu-wrap"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMenu('none');
          }}
        >
          <div class="menu" role="menu">
            {menu === 'main' && (
              <>
                <button
                  type="button"
                  class="menu-item"
                  disabled={!state.isHost}
                  onClick={() => setMenu('speed')}
                >
                  <Icon name="gauge" size={18} />
                  {t('speed')}
                  <span class="v">
                    {Math.round(state.rate * 100) / 100}x <Icon name="chevronRight" size={16} />
                  </span>
                </button>
                {state.audioTracks.length > 1 && (
                  <button type="button" class="menu-item" onClick={() => setMenu('audio')}>
                    <Icon name="volume" size={18} />
                    {t('audio')}
                    <span class="v">
                      {state.audioTracks.find((a) => a.id === state.audioTrack)?.label ?? ''}
                      <Icon name="chevronRight" size={16} />
                    </span>
                  </button>
                )}
                {state.captionTracks.length > 0 && (
                  <button type="button" class="menu-item" onClick={() => setMenu('captions')}>
                    <Icon name="subtitles" size={18} />
                    {t('subtitles')}
                    <span class="v">
                      {state.captionTrack === 'off'
                        ? t('off')
                        : (state.captionTracks.find((c) => c.id === state.captionTrack)?.label ??
                          '')}
                      <Icon name="chevronRight" size={16} />
                    </span>
                  </button>
                )}
                <button type="button" class="menu-item" onClick={() => setMenu('quality')}>
                  <Icon name="monitor" size={18} />
                  {t('quality')}
                  <span class="v">
                    {state.quality === 'auto' || !state.qualities.length
                      ? t('auto')
                      : qualityLabel(state.quality)}
                    <Icon name="chevronRight" size={16} />
                  </span>
                </button>
              </>
            )}
            {menu === 'speed' && (
              <>
                <div class="menu-head">
                  <button
                    type="button"
                    class="icon-btn"
                    onClick={() => setMenu('main')}
                    aria-label="Back"
                  >
                    <Icon name="chevronLeft" size={16} />
                  </button>
                  {t('speed')}
                </div>
                {RATES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    class={`menu-item${state.rate === r ? ' sel' : ''}`}
                    onClick={() => {
                      onCommand('rate', r);
                      setMenu('none');
                    }}
                  >
                    {r === 1 ? `1x · ${t('speed')}` : `${r}x`}
                    {state.rate === r && <Icon name="check" size={18} class="tick" />}
                  </button>
                ))}
              </>
            )}
            {menu === 'audio' && (
              <>
                <div class="menu-head">
                  <button
                    type="button"
                    class="icon-btn"
                    onClick={() => setMenu('main')}
                    aria-label="Back"
                  >
                    <Icon name="chevronLeft" size={16} />
                  </button>
                  {t('audio')}
                </div>
                <div class="menu-list">
                  {state.audioTracks.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      class={`menu-item${state.audioTrack === a.id ? ' sel' : ''}`}
                      onClick={() => {
                        onAudio(a);
                        setMenu('none');
                      }}
                    >
                      {a.label}
                      {state.audioTrack === a.id && <Icon name="check" size={18} class="tick" />}
                    </button>
                  ))}
                </div>
              </>
            )}
            {menu === 'captions' && (
              <>
                <div class="menu-head">
                  <button
                    type="button"
                    class="icon-btn"
                    onClick={() => setMenu('main')}
                    aria-label="Back"
                  >
                    <Icon name="chevronLeft" size={16} />
                  </button>
                  {t('subtitles')}
                </div>
                <div class="menu-list">
                  {[{ id: 'off', label: t('off') }, ...state.captionTracks].map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      class={`menu-item${state.captionTrack === c.id ? ' sel' : ''}`}
                      onClick={() => {
                        onCaptions(c.id);
                        setMenu('none');
                      }}
                    >
                      {c.label}
                      {state.captionTrack === c.id && <Icon name="check" size={18} class="tick" />}
                    </button>
                  ))}
                </div>
              </>
            )}
            {menu === 'quality' && (
              <>
                <div class="menu-head">
                  <button
                    type="button"
                    class="icon-btn"
                    onClick={() => setMenu('main')}
                    aria-label="Back"
                  >
                    <Icon name="chevronLeft" size={16} />
                  </button>
                  {t('quality')}
                </div>
                <button
                  type="button"
                  class={`menu-item${state.quality === 'auto' ? ' sel' : ''}`}
                  onClick={() => {
                    onQuality('auto');
                    setMenu('none');
                  }}
                >
                  {state.qualityActual && state.quality === 'auto'
                    ? t('autoNow', { q: qualityLabel(state.qualityActual) })
                    : t('auto')}
                  {state.quality === 'auto' && <Icon name="check" size={18} class="tick" />}
                </button>
                {state.qualities.map((q) => (
                  <button
                    key={q}
                    type="button"
                    class={`menu-item${state.quality === q ? ' sel' : ''}`}
                    onClick={() => {
                      onQuality(q);
                      setMenu('none');
                    }}
                  >
                    {qualityLabel(q)}
                    {state.quality === q && <Icon name="check" size={18} class="tick" />}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
