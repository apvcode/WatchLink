import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ChatMessage } from '../types.js';

const SPEED = 70; // px per second — slow enough to read
const CHAR_PX = 9;
const GAP = 48;

interface Item {
  id: string;
  name: string;
  text: string;
  delay: number;
}

/** Running line along the bottom of the fullscreen player showing new chat messages. */
export function ChatTicker({ messages }: { messages: ChatMessage[] }): JSX.Element {
  const [items, setItems] = useState<Item[]>([]);
  const seen = useRef<string | null>(messages[messages.length - 1]?.id ?? null);
  const free = useRef(0); // time (ms) when the previous item has cleared the start

  useEffect(() => {
    const idx = messages.findIndex((m) => m.id === seen.current);
    const fresh = (idx < 0 && seen.current ? messages : messages.slice(idx + 1)).filter(
      (m) => !m.isSystem,
    );
    seen.current = messages[messages.length - 1]?.id ?? null;
    if (!fresh.length) return;
    const now = Date.now();
    const added: Item[] = fresh.map((m) => {
      const text = m.text || (m.image ? '📷' : '');
      const start = Math.max(now, free.current);
      free.current = start + (((m.senderName.length + text.length) * CHAR_PX + GAP) / SPEED) * 1000;
      return { id: m.id, name: m.senderName, text, delay: (start - now) / 1000 };
    });
    setItems((prev) => [...prev, ...added]);
  }, [messages]);

  const done = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));
  const dur = (typeof window === 'undefined' ? 800 : window.innerWidth) / SPEED;

  return (
    <div class="ticker" aria-hidden="true">
      {items.map((i) => (
        <span
          key={i.id}
          class="ticker-item"
          style={{
            animationDuration: `${dur + ((i.name.length + i.text.length) * CHAR_PX) / SPEED}s`,
            animationDelay: `${i.delay}s`,
          }}
          onAnimationEnd={() => done(i.id)}
        >
          <b>{i.name}:</b> {i.text}
        </span>
      ))}
    </div>
  );
}
