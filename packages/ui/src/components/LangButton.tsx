import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Language } from '../i18n.js';

const NAMES: Record<Language, string> = { en: 'English', ru: 'Русский' };

function Globe(): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.2" />
      <path d="M3 12h18" />
      <path d="M12 2.8c2.6 2.5 3.9 5.6 3.9 9.2s-1.3 6.7-3.9 9.2c-2.6-2.5-3.9-5.6-3.9-9.2S9.4 5.3 12 2.8z" />
    </svg>
  );
}

/** Compact rounded-rectangle language switcher with a popover. */
export function LangButton({
  language,
  onChange,
}: {
  language: Language;
  onChange: (l: Language) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div class="lang" onPointerDown={(e) => e.stopPropagation()}>
      {open && (
        <div class="lang-menu" role="listbox">
          {(Object.keys(NAMES) as Language[]).map((l) => (
            <button
              key={l}
              type="button"
              role="option"
              aria-selected={l === language}
              class={l === language ? 'on' : ''}
              onClick={() => {
                onChange(l);
                setOpen(false);
              }}
            >
              <span>{NAMES[l]}</span>
              {l === language && <i />}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        class={`lang-btn${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Globe />
        <b>{language.toUpperCase()}</b>
      </button>
    </div>
  );
}
