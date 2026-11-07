import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { T } from '../i18n.js';
import { Icon } from '../icons.js';
import type { ChatMessage } from '../types.js';
import { Avatar } from './Avatar.js';

/** Finger must rest this long (without moving) to open the message menu. */
const HOLD_MS = 420;
/** Horizontal drag needed to trigger a reply. */
const SWIPE_AT = 64;
const SWIPE_MAX = 92;
/** Movement that is still treated as a steady finger. */
const SLOP = 10;

export interface MenuRequest {
  id: string;
  x: number;
  y: number;
  /** Opened by a long press (bottom sheet) rather than a right click (popover at the cursor). */
  touch: boolean;
}

type Gesture = {
  id: number;
  x: number;
  y: number;
  mode: 'wait' | 'swipe' | 'scroll' | 'held';
  passed: boolean;
  timer: number;
};

function buzz(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

/**
 * One chat line. Touch: hold to open the menu, drag right to reply.
 * Mouse: right click opens the menu.
 */
export function ChatMsgRow({
  m,
  name,
  avatar,
  t,
  picked,
  onMenu,
  onReply,
  onJump,
}: {
  m: ChatMessage;
  name: string;
  avatar?: string;
  t: T;
  picked: boolean;
  onMenu: (req: MenuRequest) => void;
  onReply: (m: ChatMessage) => void;
  onJump: (id: string) => void;
}): JSX.Element {
  const row = useRef<HTMLDivElement>(null);
  const g = useRef<Gesture | null>(null);
  const kind = useRef('mouse');
  const live = !m.isSystem;

  const settle = () => {
    const cur = g.current;
    if (cur) clearTimeout(cur.timer);
    g.current = null;
    const el = row.current;
    if (!el) return;
    el.classList.remove('dragging');
    el.style.setProperty('--dx', '0px');
    el.style.setProperty('--p', '0');
  };
  // A pending hold timer must not fire after the row is gone.
  useEffect(
    () => () => {
      if (g.current) clearTimeout(g.current.timer);
    },
    [],
  );

  const down = (e: PointerEvent) => {
    kind.current = e.pointerType;
    if (!live || e.pointerType === 'mouse' || !e.isPrimary) return;
    settle();
    const { clientX: x, clientY: y } = e;
    const cur: Gesture = {
      id: e.pointerId,
      x,
      y,
      mode: 'wait',
      passed: false,
      timer: window.setTimeout(() => {
        if (g.current !== cur || cur.mode !== 'wait') return;
        cur.mode = 'held';
        buzz(14);
        onMenu({ id: m.id, x, y, touch: true });
      }, HOLD_MS),
    };
    g.current = cur;
  };

  const move = (e: PointerEvent) => {
    const cur = g.current;
    if (!cur || e.pointerId !== cur.id || cur.mode === 'held' || cur.mode === 'scroll') return;
    const dx = e.clientX - cur.x;
    const dy = e.clientY - cur.y;
    if (cur.mode === 'wait') {
      if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
        cur.mode = 'scroll';
        clearTimeout(cur.timer);
        return;
      }
      if (dx > SLOP && dx > Math.abs(dy) * 1.3) {
        cur.mode = 'swipe';
        clearTimeout(cur.timer);
        row.current?.setPointerCapture(e.pointerId);
        row.current?.classList.add('dragging');
      } else if (Math.abs(dx) > SLOP) {
        // Leftwards or diagonal: not ours.
        cur.mode = 'scroll';
        clearTimeout(cur.timer);
        return;
      } else return;
    }
    const raw = Math.max(0, dx - SLOP);
    const shown = Math.min(raw <= SWIPE_AT ? raw : SWIPE_AT + (raw - SWIPE_AT) * 0.25, SWIPE_MAX);
    row.current?.style.setProperty('--dx', `${shown}px`);
    row.current?.style.setProperty('--p', String(Math.min(raw / SWIPE_AT, 1)));
    const passed = raw >= SWIPE_AT;
    if (passed && !cur.passed) buzz(10);
    cur.passed = passed;
  };

  const up = () => {
    const cur = g.current;
    const fire = cur?.mode === 'swipe' && cur.passed;
    settle();
    if (fire) onReply(m);
  };

  const context = (e: MouseEvent) => {
    if (!live) return;
    e.preventDefault();
    const cur = g.current;
    if (cur?.mode === 'held') return;
    if (cur) {
      clearTimeout(cur.timer);
      cur.mode = 'held';
    }
    onMenu({ id: m.id, x: e.clientX, y: e.clientY, touch: kind.current !== 'mouse' });
  };

  return (
    <div
      ref={row}
      data-mid={m.id}
      class={`msg${m.isSystem ? ' system' : ''}${m.isSelf ? ' self' : ''}${m.image ? ' has-photo' : ''}${picked ? ' picked' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={settle}
      onContextMenu={context}
    >
      {live && (
        <span class="swipe-ico" aria-hidden="true">
          <Icon name="reply" size={18} stroke={2.2} />
        </span>
      )}
      {!m.isSystem && !m.isSelf && <Avatar name={name} avatar={avatar} size={30} />}
      <div class="bubble">
        {!m.isSystem && !m.isSelf && <span class="who">{name}</span>}
        {m.reply && (
          <button
            type="button"
            class="quote"
            onClick={(e) => {
              e.stopPropagation();
              onJump(m.reply?.id ?? '');
            }}
          >
            <b>{m.reply.name}</b>
            <span>
              {m.reply.img && <Icon name="image" size={12} stroke={2} />}
              {m.reply.img ? t('photo') : m.reply.text}
            </span>
          </button>
        )}
        {m.image ? (
          <img class="photo" src={m.image} alt={t('photo')} draggable={false} />
        ) : m.sys ? (
          t(m.sys, { name: m.senderName })
        ) : (
          m.text
        )}
      </div>
    </div>
  );
}
