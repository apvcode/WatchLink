import type { ComponentChildren, JSX } from 'preact';
import { isPhone } from '../host.js';
import type { Language, T } from '../i18n.js';
import { Icon, type IconName } from '../icons.js';
import type { AppState } from '../types.js';
import { AccountCard } from './AccountCard.js';
import { ProfileForm } from './ProfileForm.js';

export function SettingsScreen({
  state,
  t,
  onBack,
  onLanguage,
  onToggleDebug,
  onToggleAmbient,
  onProfile,
}: {
  state: AppState;
  t: T;
  onBack: () => void;
  onLanguage: (language: Language) => void;
  onToggleDebug: () => void;
  onToggleAmbient: () => void;
  onProfile: (name: string, avatar: string | undefined) => void;
}): JSX.Element {
  return (
    <div class="settings-screen">
      <div class="profile-scroll">
        <div class="profile-bar">
          <button type="button" class="icon-btn" onClick={onBack} aria-label={t('back')}>
            <Icon name="chevronLeft" />
          </button>
        </div>
        <div class="profile-wrap settings-wrap">
          <header class="settings-head">
            <div class="settings-icon">
              <Icon name="settings" size={44} stroke={1.6} />
            </div>
            <h1>{t('settings')}</h1>
            <p>{t('settingsSub')}</p>
          </header>

          <Section icon="user" title={t('profile')}>
            <ProfileForm
              t={t}
              initial={state.profile}
              submitLabel={t('save')}
              onSubmit={onProfile}
            />
          </Section>

          <Section icon="link" title={t('accounts')}>
            <AccountCard t={t} />
          </Section>

          <Section icon="settings" title={t('general')}>
            <SettingRow icon="globe" title={t('language')}>
              <div class="seg settings-seg" role="group" aria-label={t('language')}>
                {(['en', 'ru'] as const).map((language) => (
                  <button
                    key={language}
                    type="button"
                    class={state.language === language ? 'on' : ''}
                    aria-pressed={state.language === language}
                    onClick={() => onLanguage(language)}
                  >
                    {language.toUpperCase()}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow icon="shield" title={t('deviceId')} hint={t('deviceIdHint')}>
              <code class="device-id">••••{state.profile.uid.slice(-4)}</code>
            </SettingRow>
            {!isPhone && (
              <SettingRow icon="monitor" title={t('ambientLight')} hint={t('ambientLightSub')}>
                <Switch
                  checked={state.ambientOn}
                  label={t('ambientLight')}
                  onClick={onToggleAmbient}
                />
              </SettingRow>
            )}
          </Section>

          <Section icon="gauge" title={t('developer')}>
            <SettingRow icon="gauge" title={t('debug')} hint={t('debugSub')}>
              <Switch checked={state.isDebugOverlay} label={t('debug')} onClick={onToggleDebug} />
            </SettingRow>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <section class="psec settings-section">
      <h2>
        <Icon name={icon} size={18} />
        {title}
      </h2>
      <div class="psec-body">{children}</div>
    </section>
  );
}

function SettingRow({
  icon,
  title,
  hint,
  children,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class="settings-row">
      <Icon name={icon} size={20} class="settings-row-icon" />
      <div class="settings-row-text">
        <span class="settings-row-title">{title}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div class="settings-row-control">{children}</div>
    </div>
  );
}

function Switch({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      class={`switch${checked ? ' on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
    />
  );
}
