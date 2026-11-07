import type { ChatReply } from '@watchlink/core';
import type { JSX } from 'preact';
import type { T } from '../i18n.js';
import { Icon } from '../icons.js';
import type { AppState } from '../types.js';
import { Ambient } from './Ambient.js';
import { Panel } from './Panel.js';
import { type PlayerCommand, Stage } from './Stage.js';
import { TopBar } from './TopBar.js';

export interface RoomActions {
  onTogglePanel: () => void;
  onTab: (tab: 'chat' | 'people') => void;
  onOpenSettings: () => void;
  onOpenLink: () => void;
  onNext: () => void;
  onLeave: () => void;
  onSend: (text: string, reply?: ChatReply) => void;
  onCopyText: (text: string) => void;
  onSendImage: (base64: string) => void;
  onHandover: (peerId: string) => void;
  onCopyInvite: () => void;
  onInviteFriends: () => void;
  onCommand: (action: PlayerCommand, value?: number) => void;
  onQuality: (quality: string) => void;
  onAudio: (track: { id: string; label: string }) => void;
  onCaptions: (id: string) => void;
  onFullscreen: () => void;
  onReload: () => void;
  onLinkDrive: () => void;
}

export function Room({
  state,
  t,
  actions,
}: {
  state: AppState;
  t: T;
  actions: RoomActions;
}): JSX.Element {
  const hostName = state.isHost ? state.profile.name : state.peers.find((p) => p.isHost)?.name;
  return (
    <div class={`room${state.isPanelOpen ? '' : ' no-panel'}${state.isFullscreen ? ' is-fs' : ''}`}>
      <TopBar
        state={state}
        t={t}
        onTogglePanel={actions.onTogglePanel}
        onOpenSettings={actions.onOpenSettings}
        onLeave={actions.onLeave}
        onCopyInvite={actions.onCopyInvite}
      />
      <main class="main">
        <div class="stage-col">
          <div class="stage-glow">
            <Ambient
              colors={state.ambientOn ? state.ambient : null}
              on={state.playing && !state.isFullscreen && state.ambientOn}
            />
            <Stage
              state={state}
              t={t}
              onCommand={actions.onCommand}
              onQuality={actions.onQuality}
              onAudio={actions.onAudio}
              onCaptions={actions.onCaptions}
              onFullscreen={actions.onFullscreen}
              onAddVideo={actions.onOpenLink}
              onReload={actions.onReload}
              onLinkDrive={actions.onLinkDrive}
            />
          </div>
          <div class="now">
            <div class={`eq${state.playing ? ' on' : ''}`}>
              <i />
              <i />
              <i />
            </div>
            <div class="titles">
              <small>{t('nowPlaying')}</small>
              <b>{state.videoTitle || state.videoUrl || '—'}</b>
            </div>
            {hostName && <small class="hide-sm">{hostName}</small>}
            {state.isHost && state.queue.length > 0 && (
              <button
                type="button"
                class="icon-btn"
                title={t('nextVideo')}
                aria-label={t('nextVideo')}
                onClick={actions.onNext}
              >
                <Icon name="next" size={18} />
                <span class="badge">{state.queue.length}</span>
              </button>
            )}
            {state.isHost && (
              <button
                type="button"
                class="icon-btn"
                title={t('addVideo')}
                aria-label={t('addVideo')}
                onClick={actions.onOpenLink}
              >
                <Icon name="plus" size={18} />
              </button>
            )}
          </div>
        </div>
      </main>
      {state.isPanelOpen && (
        <Panel
          state={state}
          t={t}
          onTab={actions.onTab}
          onSend={actions.onSend}
          onCopyText={actions.onCopyText}
          onSendImage={actions.onSendImage}
          onHandover={actions.onHandover}
          onCopyInvite={actions.onCopyInvite}
          onInviteFriends={actions.onInviteFriends}
        />
      )}
    </div>
  );
}
