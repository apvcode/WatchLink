import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Language, T } from '../i18n.js';
import { Logo } from '../icons.js';
import { Avatar } from './Avatar.js';
import { LangButton } from './LangButton.js';
import { ProfileForm } from './ProfileForm.js';

export function Onboarding({
  t,
  language,
  onLanguage,
  onDone,
}: {
  t: T;
  language: Language;
  onLanguage: (l: Language) => void;
  onDone: (name: string, avatar: string | undefined) => void;
}): JSX.Element {
  const [leaving, setLeaving] = useState<{ name: string; avatar?: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const submit = (name: string, avatar: string | undefined) => {
    if (leaving) return;
    setLeaving({ name, avatar });
    timer.current = setTimeout(() => onDone(name, avatar), 1500);
  };
  return (
    <div class={`center-screen${leaving ? ' leaving' : ''}`}>
      <div class="screen-bg" />
      <div class="card onb-card">
        <div class="brand">
          <div class="logo-wrap" data-splash-target>
            <Logo size={64} />
          </div>
          <h1>{t('welcome')}</h1>
          <p>{t('welcomeSub')}</p>
        </div>
        <ProfileForm t={t} submitLabel={t('continue')} onSubmit={submit} />
      </div>
      {!leaving && <LangButton language={language} onChange={onLanguage} />}
      {leaving && (
        <div class="onb-done">
          <div class="onb-avatar">
            <i />
            <i />
            <Avatar name={leaving.name} avatar={leaving.avatar} size={112} />
          </div>
          <small>{t('welcomeBack')}</small>
          <h2>{leaving.name}</h2>
        </div>
      )}
    </div>
  );
}
