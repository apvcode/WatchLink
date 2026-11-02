import type { ComponentChildren, JSX } from 'preact';
import { useState } from 'preact/hooks';
import { isPhone } from '../host.js';
import type { Language, T } from '../i18n.js';
import { Icon } from '../icons.js';
import type { AppState } from '../types.js';
import { AccountCard } from './AccountCard.js';
import { ProfileForm } from './ProfileForm.js';

export function Sheet({
  title,
  onClose,
  children,
  t,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  t: T;
}): JSX.Element {
  return (
    <div
      class="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="sheet" role="dialog" aria-label={title}>
        <h2>
          {title}
          <button type="button" class="icon-btn" onClick={onClose} aria-label={t('close')}>
            <Icon name="x" size={18} />
          </button>
        </h2>
        {children}
      </div>
    </div>
  );
}

export function SettingsSheet({
  state,
  t,
  onClose,
  onLanguage,
  onToggleDebug,
  onToggleAmbient,
  onProfile,
}: {
  state: AppState;
  t: T;
  onClose: () => void;
  onLanguage: (l: Language) => void;
  onToggleDebug: () => void;
  onToggleAmbient: () => void;
  onProfile: (name: string, avatar: string | undefined) => void;
}): JSX.Element {
  return (
    <Sheet title={t('settings')} onClose={onClose} t={t}>
      <ProfileForm
        t={t}
        initial={state.profile}
        submitLabel={t('save')}
        onSubmit={(name, avatar) => {
          onProfile(name, avatar);
          onClose();
        }}
      />
      <h3 class="set-h">{t('accounts')}</h3>
      <AccountCard t={t} />
      <div class="set-row" style={{ marginTop: '18px' }}>
        <div>{t('language')}</div>
        <div class="seg">
          {(['en', 'ru'] as const).map((l) => (
            <button
              key={l}
              type="button"
              class={state.language === l ? 'on' : ''}
              onClick={() => onLanguage(l)}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div class="set-row">
        <div>
          {t('deviceId')}
          <small>{t('deviceIdHint')}</small>
        </div>
        <code style={{ fontFamily: 'var(--mono)', color: 'var(--text-2)' }}>
          ••••{state.profile.uid.slice(-4)}
        </code>
      </div>
      {isPhone ? null : (
        <div class="set-row">
          <div>
            {t('ambientLight')}
            <small>{t('ambientLightSub')}</small>
          </div>
          <button
            type="button"
            class={`switch${state.ambientOn ? ' on' : ''}`}
            role="switch"
            aria-checked={state.ambientOn}
            aria-label={t('ambientLight')}
            onClick={onToggleAmbient}
          />
        </div>
      )}
      <div class="set-row">
        <div>
          {t('debug')}
          <small>{t('debugSub')}</small>
        </div>
        <button
          type="button"
          class={`switch${state.isDebugOverlay ? ' on' : ''}`}
          role="switch"
          aria-checked={state.isDebugOverlay}
          aria-label={t('debug')}
          onClick={onToggleDebug}
        />
      </div>
    </Sheet>
  );
}

export function LinkSheet({
  t,
  queue,
  onClose,
  onSubmit,
  onQueue,
  onRemove,
  onPlayNow,
}: {
  t: T;
  queue: Array<{ id: string; url: string }>;
  onClose: () => void;
  onSubmit: (url: string) => void;
  onQueue: (url: string) => void;
  onRemove: (id: string) => void;
  onPlayNow: (id: string) => void;
}): JSX.Element {
  const [url, setUrl] = useState('');
  const label = (u: string) => {
    try {
      const x = new URL(u);
      return `${x.hostname.replace(/^www\./, '')}${x.pathname === '/' ? '' : x.pathname}${x.search}`;
    } catch {
      return u;
    }
  };
  return (
    <Sheet title={t('addVideo')} onClose={onClose} t={t}>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) {
            onSubmit(url.trim());
            onClose();
          }
        }}
      >
        <input
          autoFocus
          value={url}
          placeholder={t('videoPh')}
          onInput={(e) => setUrl((e.currentTarget as HTMLInputElement).value)}
        />
        <div class="row">
          <button type="submit" class="btn btn-primary" style={{ flex: 1 }} disabled={!url.trim()}>
            <Icon name="play" size={18} />
            {t('playNow')}
          </button>
          <button
            type="button"
            class="btn"
            style={{ flex: 1 }}
            disabled={!url.trim()}
            onClick={() => {
              onQueue(url.trim());
              setUrl('');
            }}
          >
            <Icon name="plus" size={18} />
            {t('addToQueue')}
          </button>
        </div>
      </form>
      <div class="queue">
        <div class="label">{t('queue')}</div>
        {queue.length === 0 && <div class="queue-empty">{t('queueEmpty')}</div>}
        {queue.map((q, i) => (
          <div key={q.id} class="queue-item">
            <span class="n">{i + 1}</span>
            <span class="u" title={q.url}>
              {label(q.url)}
            </span>
            <button
              type="button"
              class="icon-btn"
              title={t('playNow')}
              aria-label={t('playNow')}
              onClick={() => {
                onPlayNow(q.id);
                onClose();
              }}
            >
              <Icon name="play" size={16} />
            </button>
            <button
              type="button"
              class="icon-btn"
              title={t('removeFromQueue')}
              aria-label={t('removeFromQueue')}
              onClick={() => onRemove(q.id)}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

export function LeaveSheet({
  t,
  onStay,
  onLeave,
}: {
  t: T;
  onStay: () => void;
  onLeave: () => void;
}): JSX.Element {
  return (
    <Sheet title={t('leaveTitle')} onClose={onStay} t={t}>
      <div class="stack">
        <p style={{ color: 'var(--text-2)' }}>{t('leaveSub')}</p>
        <div class="row">
          <button type="button" class="btn" style={{ flex: 1 }} onClick={onStay}>
            {t('stay')}
          </button>
          <button type="button" class="btn btn-primary" style={{ flex: 1 }} onClick={onLeave}>
            {t('leave')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function ConsentSheet({
  t,
  url,
  onConfirm,
  onCancel,
}: {
  t: T;
  url: string;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  let domain = url;
  try {
    domain = new URL(url).hostname;
  } catch {}
  return (
    <Sheet title={t('consentTitle')} onClose={onCancel} t={t}>
      <div class="stack">
        <p style={{ color: 'var(--text-2)' }}>{t('consentSub')}</p>
        <div
          class="invite-card"
          style={{ fontFamily: 'var(--mono)', fontWeight: 700, wordBreak: 'break-all' }}
        >
          <Icon name="globe" size={20} />
          {domain}
        </div>
        <div class="row">
          <button type="button" class="btn" style={{ flex: 1 }} onClick={onCancel}>
            {t('cancel')}
          </button>
          <button type="button" class="btn btn-primary" style={{ flex: 1 }} onClick={onConfirm}>
            {t('open')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function Toast({
  message,
  t,
  onRetry,
  onDismiss,
}: {
  message: string;
  t: T;
  onRetry?: () => void;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div class="toast" role="alert">
      <Icon name="alert" size={20} />
      <span>{message}</span>
      {onRetry && (
        <button type="button" class="btn btn-sm" onClick={onRetry}>
          {t('retry')}
        </button>
      )}
      <button type="button" class="icon-btn" onClick={onDismiss} aria-label={t('dismiss')}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

export function DebugOverlay({ state }: { state: AppState }): JSX.Element {
  return (
    <div class="debug">
      <div>lamport: {state.lamportTime}</div>
      <div>rtt: {state.medianRttMs.toFixed(0)} ms</div>
      <div>peers: {state.peers.length + 1}</div>
      <div>sync: {state.syncState}</div>
      <div>
        rate: {state.rate} · {state.qualityActual || '—'}
      </div>
    </div>
  );
}
