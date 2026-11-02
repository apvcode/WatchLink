import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { T } from '../i18n.js';
import { Icon, Logo } from '../icons.js';
import type { AppState } from '../types.js';

export function TopBar({
  state,
  t,
  onTogglePanel,
  onOpenSettings,
  onLeave,
  onCopyInvite,
}: {
  state: AppState;
  t: T;
  onTogglePanel: () => void;
  onOpenSettings: () => void;
  onLeave: () => void;
  onCopyInvite: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const conn = state.connection;
  const tone =
    conn === 'connected'
      ? state.syncState === 'sync'
        ? 'ok'
        : 'warn'
      : conn === 'error' || conn === 'full'
        ? 'bad'
        : 'warn';
  const label =
    conn === 'connected'
      ? state.syncState === 'nudge'
        ? t('nudging')
        : state.syncState === 'buffering'
          ? t('buffering')
          : t('inSync')
      : conn === 'waiting'
        ? t('waitingPeers')
        : conn === 'connecting'
          ? t('connecting')
          : t('offline');
  return (
    <header class="topbar">
      <Logo size={30} />
      <div class="grow">
        <div class="room-id">
          <span>
            {t('room')} · {state.roomId.slice(0, 6) || '—'}
          </span>
        </div>
      </div>
      <span class={`status hide-sm ${tone}`} title={`${state.medianRttMs.toFixed(0)} ms`}>
        <i />
        {label}
      </span>
      <button
        type="button"
        class={`icon-btn${copied ? ' on' : ''}`}
        title={t('copyInvite')}
        aria-label={t('copyInvite')}
        onClick={() => {
          onCopyInvite();
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
      >
        <Icon name={copied ? 'check' : 'link'} size={19} />
      </button>
      <button
        type="button"
        class={`icon-btn hide-sm${state.isPanelOpen ? ' on' : ''}`}
        title={state.isPanelOpen ? t('hidePanel') : t('showPanel')}
        aria-label={state.isPanelOpen ? t('hidePanel') : t('showPanel')}
        onClick={onTogglePanel}
      >
        <Icon name="panel" size={19} />
        {state.peers.length + 1 > 1 && <span class="badge">{state.peers.length + 1}</span>}
      </button>
      <button
        type="button"
        class="icon-btn"
        title={t('settings')}
        aria-label={t('settings')}
        onClick={onOpenSettings}
      >
        <Icon name="settings" size={19} />
      </button>
      <button
        type="button"
        class="icon-btn"
        title={t('leave')}
        aria-label={t('leave')}
        onClick={onLeave}
      >
        <Icon name="logout" size={19} />
      </button>
    </header>
  );
}
