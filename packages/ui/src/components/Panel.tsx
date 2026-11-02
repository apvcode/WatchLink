import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { T } from '../i18n.js';
import { Icon } from '../icons.js';
import { photoToBase64 } from '../image.js';
import type { AppState } from '../types.js';
import { Avatar } from './Avatar.js';

export function Panel({
  state,
  t,
  onTab,
  onSend,
  onSendImage,
  onHandover,
  onCopyInvite,
  onInviteFriends,
}: {
  state: AppState;
  t: T;
  onTab: (tab: 'chat' | 'people') => void;
  onSend: (text: string) => void;
  onSendImage: (base64: string) => void;
  onHandover: (peerId: string) => void;
  onCopyInvite: () => void;
  onInviteFriends: () => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const [photoErr, setPhotoErr] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  // Grow the field upward with its content (the composer is anchored to the bottom).
  // Height is measured on a hidden twin so the real field is never collapsed mid-transition.
  useEffect(() => {
    const el = area.current;
    const twin = measure.current;
    if (!el || !twin) return;
    twin.style.width = `${el.clientWidth}px`;
    twin.textContent = `${text}\u200b`;
    el.style.height = `${Math.min(Math.max(twin.scrollHeight, 24), 132)}px`;
  }, [text]);
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    const b64 = await photoToBase64(file);
    if (b64) onSendImage(b64);
    else {
      setPhotoErr(true);
      setTimeout(() => setPhotoErr(false), 2400);
    }
  };
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [state.chatMessages.length, state.activeTab]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (!(e.target as HTMLElement).closest('.attach')) setMenu(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  const send = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  };
  const people = [
    {
      id: state.myPeerId,
      name: state.profile.name,
      avatar: state.profile.avatar,
      isHost: state.isHost,
      isBuffering: state.buffering,
      me: true,
    },
    ...state.peers.map((p) => ({ ...p, me: false })),
  ];
  return (
    <aside class="panel">
      <div class="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={state.activeTab === 'chat'}
          class={`tab${state.activeTab === 'chat' ? ' active' : ''}`}
          onClick={() => onTab('chat')}
        >
          <Icon name="message" size={17} />
          {t('chat')}
          {state.unread > 0 && state.activeTab !== 'chat' && <i class="dot" />}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={state.activeTab === 'people'}
          class={`tab${state.activeTab === 'people' ? ' active' : ''}`}
          onClick={() => onTab('people')}
        >
          <Icon name="users" size={17} />
          {t('people')}
          <span class="count tabular">{people.length}</span>
        </button>
      </div>

      {state.activeTab === 'chat' ? (
        <>
          <div class="scroll chat-scroll" ref={list}>
            {state.isHost && (
              <div class="invite-card">
                <Icon name="link" size={22} />
                <div class="t">
                  <b>{t('inviteFriends')}</b>
                  <small>{state.roomUrl}</small>
                </div>
                <button
                  type="button"
                  class="icon-btn"
                  title={t('inviteToRoom')}
                  aria-label={t('inviteToRoom')}
                  onClick={onInviteFriends}
                >
                  <Icon name="users" size={18} />
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  title={t('copyInvite')}
                  aria-label={t('copyInvite')}
                  onClick={() => {
                    onCopyInvite();
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }}
                >
                  <Icon name={copied ? 'check' : 'copy'} size={18} />
                </button>
              </div>
            )}
            {state.chatMessages.length === 0 && <div class="empty">{t('chatEmpty')}</div>}
            {state.chatMessages.map((m) => {
              // Look up the sender's current profile so avatar/name changes show on old messages too.
              const sender = m.isSelf
                ? state.profile
                : state.peers.find((p) => p.id === m.senderId);
              const name = m.isSystem ? m.senderName : (sender?.name ?? m.senderName);
              const avatar = sender ? sender.avatar : m.senderAvatar;
              return (
                <div
                  key={m.id}
                  class={`msg${m.isSystem ? ' system' : ''}${m.isSelf ? ' self' : ''}${m.image ? ' has-photo' : ''}`}
                >
                  {!m.isSystem && !m.isSelf && <Avatar name={name} avatar={avatar} size={30} />}
                  <div class="bubble">
                    {!m.isSystem && !m.isSelf && <span class="who">{name}</span>}
                    {m.image ? (
                      <img class="photo" src={m.image} alt={t('photo')} />
                    ) : m.sys ? (
                      t(m.sys, { name: m.senderName })
                    ) : (
                      m.text
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <form
            class="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div class="attach">
              {menu && (
                <div class="attach-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    class="attach-item"
                    onClick={() => {
                      setMenu(false);
                      fileInput.current?.click();
                    }}
                  >
                    <span class="ico">
                      <Icon name="image" size={22} stroke={1.7} />
                    </span>
                    {t('photo')}
                  </button>
                </div>
              )}
              <button
                type="button"
                class={`glass-btn plus${menu ? ' open' : ''}`}
                aria-label={t('attach')}
                aria-expanded={menu}
                title={t('attach')}
                onClick={() => setMenu((v) => !v)}
              >
                <Icon name="plus" size={24} stroke={1.8} />
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const el = e.currentTarget as HTMLInputElement;
                  void pickPhoto(el.files?.[0]);
                  el.value = '';
                }}
              />
            </div>
            {photoErr && <div class="composer-toast">{t('photoFail')}</div>}
            <div class={`field${text.trim() ? ' ready' : ''}`}>
              <div class="ta-measure" ref={measure} aria-hidden="true" />
              <textarea
                ref={area}
                rows={1}
                value={text}
                placeholder={t('chatPh')}
                maxLength={500}
                aria-label={t('chat')}
                enterkeyhint="send"
                onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button
                type="submit"
                class="send"
                disabled={!text.trim()}
                aria-label={t('send')}
                title={t('send')}
              >
                <Icon name="arrowUp" size={22} stroke={2.4} />
              </button>
            </div>
          </form>
        </>
      ) : (
        <div class="scroll">
          {people.map((p) => (
            <div class="person" key={p.id}>
              <Avatar name={p.name} avatar={p.avatar} size={42} host={p.isHost} />
              <div class="grow">
                <div class="name">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                  {p.me && <span class="tag me">{t('you')}</span>}
                  {p.isHost && <span class="tag">{t('host')}</span>}
                </div>
                {p.isBuffering && <small>{t('buffering')}…</small>}
              </div>
              {state.isHost && !p.me && (
                <button
                  type="button"
                  class="btn btn-sm"
                  title={t('makeHost')}
                  onClick={() => onHandover(p.id)}
                >
                  <Icon name="crown" size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
