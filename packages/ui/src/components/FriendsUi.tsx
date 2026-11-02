import type { Friend, FriendsSnapshot } from '@watchlink/core';
import { friendCode } from '@watchlink/core';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { T } from '../i18n.js';
import { Icon } from '../icons.js';
import { Avatar } from './Avatar.js';
import { Sheet } from './Sheets.js';

export function statusLabel(friends: FriendsSnapshot, f: Friend, t: T): string {
  const p = friends.presence[f.pub];
  if (!p?.online) return t('offline');
  return p.status === 'watching' ? t('watchingNow') : t('online');
}

export function FriendsCard({
  friends,
  t,
  onAdd,
  onOpen,
  onJoin,
}: {
  friends: FriendsSnapshot;
  t: T;
  onAdd: () => void;
  onOpen: (pub: string) => void;
  onJoin: (code: string) => void;
}): JSX.Element {
  const list = [...friends.friends].sort(
    (a, b) =>
      Number(friends.presence[b.pub]?.online ?? false) -
        Number(friends.presence[a.pub]?.online ?? false) || a.name.localeCompare(b.name),
  );
  const online = list.filter((f) => friends.presence[f.pub]?.online).length;
  return (
    <div class="recent friends-card">
      <h2>
        {t('friendsTitle')}
        {online > 0 && (
          <small class="online-count">{t('friendsOnline', { n: String(online) })}</small>
        )}
        <button type="button" class="btn btn-sm add-btn" onClick={onAdd}>
          <Icon name="plus" size={15} />
          {friends.incoming.length > 0 && <span class="badge">{friends.incoming.length}</span>}
          {t('addFriend')}
        </button>
      </h2>
      {list.length === 0 ? (
        <p class="empty">{t('noFriends')}</p>
      ) : (
        <ul class="friend-list">
          {list.map((f) => {
            const p = friends.presence[f.pub];
            return (
              <li key={f.pub}>
                <button type="button" class="friend-row" onClick={() => onOpen(f.pub)}>
                  <span class={`ava-wrap${p?.online ? ' on' : ''}`}>
                    <Avatar name={f.name} avatar={f.avatar} size={40} />
                  </span>
                  <span class="friend-info">
                    <b>{f.name}</b>
                    <small>{statusLabel(friends, f, t)}</small>
                  </span>
                </button>
                {p?.invite && (
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    onClick={() => p.invite && onJoin(p.invite.code)}
                  >
                    {t('joinNow')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function FriendsSheet({
  t,
  friends,
  myPub,
  onClose,
  onRequest,
  onAccept,
  onDecline,
  onCancel,
  onCopy,
}: {
  t: T;
  friends: FriendsSnapshot;
  myPub: string;
  onClose: () => void;
  onRequest: (code: string) => 'ok' | 'invalid' | 'self' | 'known';
  onAccept: (pub: string) => void;
  onDecline: (pub: string) => void;
  onCancel: (pub: string) => void;
  onCopy: (text: string) => void;
}): JSX.Element {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const mine = myPub ? friendCode(myPub) : '';
  return (
    <Sheet title={t('addFriend')} onClose={onClose} t={t}>
      <div class="stack">
        <label class="label" for="wl-mycode">
          {t('yourCode')}
        </label>
        <div class="row">
          <input id="wl-mycode" value={mine} readOnly onFocus={(e) => e.currentTarget.select()} />
          <button
            type="button"
            class="btn"
            onClick={() => {
              onCopy(mine);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={18} />
            {t('copyCode')}
          </button>
        </div>
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            const r = onRequest(code);
            setMsg(
              r === 'ok'
                ? t('requestSent')
                : r === 'self'
                  ? t('codeSelf')
                  : r === 'known'
                    ? t('codeKnown')
                    : t('codeInvalid'),
            );
            if (r === 'ok') setCode('');
          }}
        >
          <input
            value={code}
            placeholder={t('friendCodePh')}
            onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)}
          />
          <button type="submit" class="btn btn-primary" disabled={!code.trim()}>
            {t('sendRequest')}
          </button>
        </form>
        {msg && <p class="fine-msg">{msg}</p>}

        {friends.incoming.length > 0 && (
          <>
            <div class="label">{t('requestsTitle')}</div>
            {friends.incoming.map((r) => (
              <div class="req-row" key={r.pub}>
                <Avatar name={r.name} avatar={r.avatar} size={36} />
                <b>{r.name}</b>
                <button
                  type="button"
                  class="btn btn-sm btn-primary"
                  onClick={() => onAccept(r.pub)}
                >
                  {t('accept')}
                </button>
                <button type="button" class="btn btn-sm" onClick={() => onDecline(r.pub)}>
                  {t('decline')}
                </button>
              </div>
            ))}
          </>
        )}
        {friends.outgoing.length > 0 && (
          <>
            <div class="label">{t('pendingOut')}</div>
            {friends.outgoing.map((o) => (
              <div class="req-row" key={o.pub}>
                <Avatar name="?" size={36} />
                <b class="tabular">@{o.pub.slice(0, 8)}</b>
                <button type="button" class="btn btn-sm" onClick={() => onCancel(o.pub)}>
                  {t('cancel')}
                </button>
              </div>
            ))}
          </>
        )}
        <p class="fine-msg">{t('friendsHint')}</p>
      </div>
    </Sheet>
  );
}

export function InviteSheet({
  t,
  friends,
  invited,
  onInvite,
  onClose,
}: {
  t: T;
  friends: FriendsSnapshot;
  invited: string[];
  onInvite: (pub: string) => void;
  onClose: () => void;
}): JSX.Element {
  const list = [...friends.friends].sort(
    (a, b) =>
      Number(friends.presence[b.pub]?.online ?? false) -
      Number(friends.presence[a.pub]?.online ?? false),
  );
  return (
    <Sheet title={t('inviteToRoom')} onClose={onClose} t={t}>
      {list.length === 0 ? (
        <p class="empty">{t('noFriendsToInvite')}</p>
      ) : (
        <ul class="friend-list">
          {list.map((f) => {
            const online = friends.presence[f.pub]?.online;
            const done = invited.includes(f.pub);
            return (
              <li key={f.pub}>
                <span class="friend-row">
                  <span class={`ava-wrap${online ? ' on' : ''}`}>
                    <Avatar name={f.name} avatar={f.avatar} size={40} />
                  </span>
                  <span class="friend-info">
                    <b>{f.name}</b>
                    <small>{statusLabel(friends, f, t)}</small>
                  </span>
                </span>
                <button
                  type="button"
                  class="btn btn-sm btn-primary"
                  disabled={!online || done}
                  onClick={() => onInvite(f.pub)}
                >
                  {done ? t('invited') : t('invite')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

/** Incoming invitation from a friend, shown over any screen. */
export function InviteBanner({
  t,
  name,
  avatar,
  title,
  onJoin,
  onDismiss,
}: {
  t: T;
  name: string;
  avatar?: string;
  title: string;
  onJoin: () => void;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div class="toast invite-banner" role="alert">
      <Avatar name={name} avatar={avatar} size={36} />
      <span class="ib-text">
        <b>{t('invitesYou', { name })}</b>
        {title && <small>{title}</small>}
      </span>
      <button type="button" class="btn btn-sm btn-primary" onClick={onJoin}>
        {t('joinNow')}
      </button>
      <button type="button" class="icon-btn" onClick={onDismiss} aria-label={t('dismiss')}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
