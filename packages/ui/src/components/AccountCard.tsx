import type { JSX } from 'preact';
import { google, useGoogle } from '../google.js';
import type { T } from '../i18n.js';
import { DriveLogo, Icon } from '../icons.js';

/** Settings card for the linked Google account (Drive). */
export function AccountCard({ t }: { t: T }): JSX.Element {
  const g = useGoogle();
  const state = g.linking ? 'linking' : g.linked ? 'linked' : g.needsRelink ? 'expired' : 'idle';
  return (
    <div class={`acct acct-${state}`}>
      <div class="acct-logo">
        <DriveLogo size={26} />
        <span class="acct-ring" aria-hidden="true" />
      </div>
      <div class="acct-text">
        <b>{t('googleDrive')}</b>
        <small key={state}>
          {state === 'linked' && g.profile
            ? g.profile.email
            : state === 'linking'
              ? t('googleLinking')
              : state === 'expired'
                ? t('googleExpired')
                : g.error && g.error !== 'cancelled'
                  ? t('googleFailed')
                  : g.configured
                    ? t('googleDriveSub')
                    : t('googleUnavailable')}
        </small>
      </div>
      {state === 'linked' && g.profile?.picture && (
        <img class="acct-avatar" src={g.profile.picture} alt="" referrerpolicy="no-referrer" />
      )}
      {state === 'linking' ? (
        <button type="button" class="btn btn-sm" onClick={() => google.cancel()}>
          {t('googleCancel')}
        </button>
      ) : state === 'linked' ? (
        <button type="button" class="btn btn-sm" onClick={() => google.unlink()}>
          {t('googleUnlink')}
        </button>
      ) : (
        <button
          type="button"
          class="btn btn-sm btn-primary"
          disabled={!g.configured}
          onClick={() => google.link()}
        >
          <Icon name="link" size={16} />
          {t('googleLinkBtn')}
        </button>
      )}
    </div>
  );
}
