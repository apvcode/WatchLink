import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import type { T } from '../i18n.js';
import { Icon } from '../icons.js';

const POP_W = 220;
const POP_ITEM_H = 48;

/**
 * Actions for one chat message: a translucent bottom sheet after a long press,
 * a small popover at the cursor after a right click.
 */
export function MsgMenu({
  t,
  x,
  y,
  touch,
  canCopy,
  onCopy,
  onReply,
  onClose,
}: {
  t: T;
  x: number;
  y: number;
  touch: boolean;
  canCopy: boolean;
  onCopy: () => void;
  onReply: () => void;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const items = (canCopy ? 2 : 1) * POP_ITEM_H + 16;
  const pos: JSX.CSSProperties | undefined = touch
    ? undefined
    : {
        left: `${Math.max(8, Math.min(x, window.innerWidth - POP_W - 8))}px`,
        top: `${Math.max(8, Math.min(y, window.innerHeight - items - 8))}px`,
      };

  return (
    <div
      class={`msgmenu-wrap${touch ? ' touch' : ''}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        // After a long press the system sends its own contextmenu event, and it lands on this
        // freshly shown sheet: it must not close it.
        if (!touch && e.target === e.currentTarget) onClose();
      }}
    >
      <div class="msgmenu" role="menu" style={pos}>
        {canCopy && (
          <button
            type="button"
            role="menuitem"
            class="msgmenu-item"
            onClick={() => {
              onCopy();
              onClose();
            }}
          >
            <Icon name="copy" size={20} stroke={1.9} />
            {t('msgCopy')}
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          class="msgmenu-item"
          onClick={() => {
            onReply();
            onClose();
          }}
        >
          <Icon name="reply" size={20} stroke={1.9} />
          {t('msgReply')}
        </button>
      </div>
    </div>
  );
}
