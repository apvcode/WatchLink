import type { ChatReply } from '@watchlink/core';
import { CHAT_REPLY_MAX } from '@watchlink/core';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { T } from '../i18n.js';
import { Icon } from '../icons.js';
import { photoToBase64 } from '../image.js';
import type { AppState, ChatMessage } from '../types.js';
import { Avatar } from './Avatar.js';
import { ChatMsgRow, type MenuRequest } from './ChatMsgRow.js';
import { MsgMenu } from './MsgMenu.js';

export function Panel({
  state,
  t,
  onTab,
  onSend,
  onCopyText,
  onSendImage,
  onHandover,
  onCopyInvite,
  onInviteFriends,
}: {
  state: AppState;
  t: T;
  onTab: (tab: 'chat' | 'people') => void;
  onSend: (text: string, reply?: ChatReply) => void;
  onCopyText: (text: string) => void;
  onSendImage: (base64: string) => void;
  onHandover: (peerId: string) => void;
  onCopyInvite: () => void;
  onInviteFriends: () => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const [photoErr, setPhotoErr] = useState(false);
  const [menuFor, setMenuFor] = useState<MenuRequest | null>(null);
  const [replyTo, setReplyTo] = useState<ChatReply | null>(null);
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
    onSend(text.trim(), replyTo ?? undefined);
    setText('');
    setReplyTo(null);
    // Keep the field focused so the on-screen keyboard stays up for the next message.
    area.current?.focus();
  };
  const nameOf = (m: ChatMessage): string =>
    (m.isSelf
      ? state.profile.name
      : (state.peers.find((p) => p.id === m.senderId)?.name ?? m.senderName)) || t('you');
  const startReply = (m: ChatMessage) => {
    if (m.isSystem) return;
    setReplyTo({
      id: m.id,
      name: nameOf(m),
      text: m.image ? '' : m.text.replace(/\s+/g, ' ').trim().slice(0, CHAT_REPLY_MAX),
      ...(m.image ? { img: true } : {}),
    });
    area.current?.focus();
    requestAnimationFrame(() =>
      list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }),
    );
  };
  const jumpTo = (id: string) => {
    const el = list.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1400);
  };
  const menuMsg = menuFor ? state.chatMessages.find((m) => m.id === menuFor.id) : undefined;
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
          <div class={`scroll chat-scroll${replyTo ? ' replying' : ''}`} ref={list}>
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
                <ChatMsgRow
                  key={m.id}
                  m={m}
                  name={name}
                  avatar={avatar}
                  t={t}
                  picked={menuFor?.id === m.id}
                  onMenu={setMenuFor}
                  onReply={startReply}
                  onJump={jumpTo}
                />
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
            {replyTo && (
              <div class="reply-bar">
                <Icon name="reply" size={18} stroke={2} />
                <div class="rb-text">
                  <b>{t('replyTo', { name: replyTo.name })}</b>
                  <span>{replyTo.img ? t('photo') : replyTo.text}</span>
                </div>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label={t('cancel')}
                  title={t('cancel')}
                  onClick={() => setReplyTo(null)}
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
            )}
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
                  if (e.key === 'Escape' && replyTo) {
                    setReplyTo(null);
                  } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button
                type="submit"
                class="send"
                // Tapping the button must not pull focus off the field (that closes the keyboard).
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                disabled={!text.trim()}
                aria-label={t('send')}
                title={t('send')}
              >
                <Icon name="arrowUp" size={22} stroke={2.4} />
              </button>
            </div>
          </form>
          {menuFor && menuMsg && (
            <MsgMenu
              t={t}
              x={menuFor.x}
              y={menuFor.y}
              touch={menuFor.touch}
              canCopy={Boolean(menuMsg.text) && !menuMsg.image}
              onCopy={() => onCopyText(menuMsg.text)}
              onReply={() => startReply(menuMsg)}
              onClose={() => setMenuFor(null)}
            />
          )}
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
