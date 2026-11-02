import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useRef, useState } from 'preact/hooks';
import type { T } from '../i18n.js';
import { Icon } from '../icons.js';
import type { Profile } from '../types.js';
import { Avatar } from './Avatar.js';
import { AvatarCropper } from './AvatarCropper.js';

export function ProfileForm({
  t,
  initial,
  submitLabel,
  onSubmit,
}: {
  t: T;
  initial?: Profile;
  submitLabel: string;
  onSubmit: (name: string, avatar: string | undefined) => void;
}): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [avatar, setAvatar] = useState<string | undefined>(initial?.avatar);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const valid = name.trim().length > 0;
  return (
    <form
      class="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(name.trim(), avatar);
      }}
    >
      <div class="avatar-pick">
        <button
          type="button"
          class="avatar-btn"
          aria-label={t('pickPhoto')}
          title={t('pickPhoto')}
          onClick={() => file.current?.click()}
        >
          <Avatar name={name || '?'} avatar={avatar} size={96} />
          <span class="avatar-badge">
            <Icon name="camera" size={15} />
          </span>
        </button>
        {avatar && (
          <button type="button" class="btn btn-sm btn-ghost" onClick={() => setAvatar(undefined)}>
            {t('removePhoto')}
          </button>
        )}
        <input
          ref={file}
          class="sr"
          type="file"
          accept="image/*"
          tabIndex={-1}
          onChange={(e) => {
            const input = e.currentTarget as HTMLInputElement;
            const f = input.files?.[0];
            input.value = '';
            if (f) setCropFile(f);
          }}
        />
      </div>
      {cropFile &&
        createPortal(
          <AvatarCropper
            t={t}
            file={cropFile}
            onCancel={() => setCropFile(null)}
            onDone={(url) => {
              setAvatar(url);
              setCropFile(null);
            }}
          />,
          document.body,
        )}
      <label class="label" for="wl-nick">
        {t('nickname')}
      </label>
      <input
        id="wl-nick"
        value={name}
        maxLength={24}
        placeholder={t('nicknamePh')}
        autoComplete="off"
        onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
      />
      <button type="submit" class="btn btn-primary btn-block" disabled={!valid}>
        {submitLabel}
      </button>
    </form>
  );
}
