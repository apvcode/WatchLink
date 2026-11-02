import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  type DriveItem,
  type DriveListRequest,
  type DriveView,
  driveShareUrl,
  fmtSize,
} from '../drive-links.js';
import { fmtDuration } from '../format.js';
import { google, useGoogle } from '../google.js';
import type { T } from '../i18n.js';
import { DriveLogo, Icon } from '../icons.js';

type Tab = Exclude<DriveView, 'search'>;
interface Crumb {
  id: string;
  name: string;
}

/** Own file browser for the linked Google Drive: pick a video, the room is created from it. */
export function DrivePicker({
  t,
  onBack,
  onPick,
}: {
  t: T;
  onBack: () => void;
  onPick: (url: string) => void;
}): JSX.Element {
  const g = useGoogle();
  const [tab, setTab] = useState<Tab>('mine');
  const [path, setPath] = useState<Crumb[]>([]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<DriveItem[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<DriveItem | null>(null);
  const run = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  // Debounce the search box.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const request = (pageToken?: string): DriveListRequest =>
    query
      ? { view: 'search', query, pageToken }
      : { view: tab, folderId: path.at(-1)?.id, pageToken };

  const load = (more: boolean) => {
    const id = ++run.current;
    setLoading(true);
    setError('');
    google
      .list(request(more ? next : undefined))
      .then((result) => {
        if (id !== run.current) return;
        setItems((current) => (more ? [...current, ...result.files] : result.files));
        setNext(result.nextPageToken);
      })
      .catch((e: Error) => id === run.current && setError(e.message))
      .finally(() => id === run.current && setLoading(false));
  };

  // Reload whenever the place we are looking at changes.
  useEffect(() => {
    if (!g.linked) return;
    setItems([]);
    setNext(undefined);
    load(false);
  }, [g.linked, tab, path, query]);

  // Endless scrolling.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !next || loading || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) load(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [next, loading]);

  const choose = (file: DriveItem) => {
    if (file.isFolder) {
      setSearch('');
      setQuery('');
      setTab('mine');
      setPath((p) => [...p, { id: file.id, name: file.name }]);
    } else if (file.access === 'private') setConfirm(file);
    else onPick(driveShareUrl(file.id, file.resourceKey));
  };

  const blocked = error === 'not-linked' || error === '401';
  const body = !g.linked ? (
    <LinkPrompt t={t} />
  ) : blocked ? (
    <LinkPrompt t={t} expired />
  ) : error ? (
    <div class="drive-state">
      <Icon name="alert" size={30} />
      <p>{t('driveLoadFail')}</p>
      <button type="button" class="btn" onClick={() => load(false)}>
        <Icon name="refresh" size={16} />
        {t('driveRetry')}
      </button>
    </div>
  ) : (
    <>
      <div class="drive-grid">
        {items.map((file, i) => (
          <FileCard key={file.id} file={file} index={i} t={t} onClick={() => choose(file)} />
        ))}
        {loading &&
          items.length === 0 &&
          Array.from({ length: 8 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
            <div key={i} class="dcard skel" style={{ '--i': i } as JSX.CSSProperties} />
          ))}
      </div>
      {!loading && items.length === 0 && (
        <div class="drive-state">
          <Icon name="folder" size={30} />
          <p>{query ? t('driveEmptySearch') : t('driveEmpty')}</p>
        </div>
      )}
      <div ref={sentinel} class="drive-more">
        {loading && items.length > 0 ? t('driveMore') : ''}
      </div>
    </>
  );

  return (
    <div class="drive">
      <div class="drive-scroll">
        <div class="drive-col">
          <header class="drive-bar">
            <button type="button" class="icon-btn" onClick={onBack} aria-label={t('driveBack')}>
              <Icon name="chevronLeft" size={20} />
            </button>
            <span class="drive-mark" style={{ viewTransitionName: 'drive-chip' }}>
              <DriveLogo size={22} />
              <b>{t('driveTitle')}</b>
            </span>
            {g.linked && g.profile && (
              <span class="drive-who" title={g.profile.email}>
                {g.profile.picture && (
                  <img src={g.profile.picture} alt="" referrerpolicy="no-referrer" />
                )}
                <span>{g.profile.email}</span>
              </span>
            )}
          </header>

          {g.linked && !blocked && (
            <>
              <div class="drive-tools">
                <div class="seg drive-tabs">
                  {(['mine', 'shared', 'recent'] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      class={!query && tab === id ? 'on' : ''}
                      onClick={() => {
                        setSearch('');
                        setQuery('');
                        setPath([]);
                        setTab(id);
                      }}
                    >
                      {t(
                        id === 'mine'
                          ? 'driveMine'
                          : id === 'shared'
                            ? 'driveShared'
                            : 'driveRecent',
                      )}
                    </button>
                  ))}
                </div>
                <label class="drive-search">
                  <Icon name="search" size={16} />
                  <input
                    value={search}
                    placeholder={t('driveSearchPh')}
                    onInput={(e) => setSearch((e.currentTarget as HTMLInputElement).value)}
                  />
                </label>
              </div>
              {!query && tab === 'mine' && path.length > 0 && (
                <nav class="drive-crumbs" aria-label="path">
                  <button type="button" onClick={() => setPath([])}>
                    {t('driveMine')}
                  </button>
                  {path.map((crumb, i) => (
                    <span key={crumb.id}>
                      <Icon name="chevronRight" size={14} />
                      <button type="button" onClick={() => setPath(path.slice(0, i + 1))}>
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                </nav>
              )}
            </>
          )}

          <div class="drive-body" key={`${tab}:${path.length}:${query ? 's' : ''}`}>
            {body}
          </div>
        </div>
      </div>

      {confirm && (
        <div
          class="scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirm(null);
          }}
        >
          <div class="sheet drive-confirm" role="dialog" aria-label={t('drivePrivateTitle')}>
            <Icon name="lock" size={28} />
            <h3>{t('drivePrivateTitle')}</h3>
            <p>{t('drivePrivateSub')}</p>
            <button
              type="button"
              class="btn"
              onClick={() => google.openExternal(driveShareUrl(confirm.id, confirm.resourceKey))}
            >
              <Icon name="globe" size={16} />
              {t('driveOpenSharing')}
            </button>
            <button
              type="button"
              class="btn btn-primary"
              onClick={() => onPick(driveShareUrl(confirm.id, confirm.resourceKey))}
            >
              <Icon name="play" size={16} />
              {t('drivePrivateAnyway')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkPrompt({ t, expired }: { t: T; expired?: boolean }): JSX.Element {
  const g = useGoogle();
  return (
    <div class="drive-state drive-link">
      <div class="drive-hero">
        <DriveLogo size={64} />
      </div>
      <h2>{t('driveLinkTitle')}</h2>
      <p>{expired || g.needsRelink ? t('googleExpired') : t('driveLinkSub')}</p>
      {g.linking ? (
        <>
          <p class="drive-wait">{t('googleLinking')}</p>
          <button type="button" class="btn" onClick={() => google.cancel()}>
            {t('googleCancel')}
          </button>
        </>
      ) : (
        <button
          type="button"
          class="btn btn-primary"
          disabled={!g.configured}
          onClick={() => google.link()}
        >
          <Icon name="link" size={18} />
          {g.configured ? t('googleLinkBtn') : t('googleUnavailable')}
        </button>
      )}
      {g.error && g.error !== 'cancelled' && <p class="drive-err">{t('googleFailed')}</p>}
    </div>
  );
}

function FileCard({
  file,
  index,
  t,
  onClick,
}: {
  file: DriveItem;
  index: number;
  t: T;
  onClick: () => void;
}): JSX.Element {
  const meta = [file.durationMs ? fmtDuration(file.durationMs / 1000, t) : '', fmtSize(file.size)]
    .filter(Boolean)
    .join(' · ');
  return (
    <button
      type="button"
      class={`dcard${file.isFolder ? ' dfolder' : ''}`}
      style={{ '--i': Math.min(index, 14) } as JSX.CSSProperties}
      onClick={onClick}
      title={file.name}
    >
      <div class="dthumb">
        {file.isFolder ? (
          <Icon name="folder" size={34} />
        ) : file.thumbnail ? (
          <img src={file.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" />
        ) : (
          <Icon name="play" size={28} />
        )}
        {file.access === 'link' && (
          <span class="dbadge" title={t('driveAccessLink')}>
            <Icon name="globe" size={12} />
          </span>
        )}
        {file.access === 'private' && (
          <span class="dbadge lock" title={t('driveAccessPrivate')}>
            <Icon name="lock" size={12} />
          </span>
        )}
      </div>
      <span class="dtitle">{file.name}</span>
      {meta && <span class="dmeta">{meta}</span>}
    </button>
  );
}
