# Privacy Policy / Политика конфиденциальности

_Last updated: 2026-11-02_

WatchLink is a peer-to-peer watch-together app. It has no servers of its own and collects no personal data.

## Google account and Google Drive

If you choose to link a Google account, WatchLink requests read-only access to your Google Drive (`drive.readonly`) solely to:

- list your video files so you can pick one for a room;
- stream the chosen video to **your own device** for playback.

What we do and do not do:

- Access and refresh tokens are stored **only on your device**, in the system's secure storage (OS keyring on Linux, Android Keystore on Android).
- Nothing from your Google account is sent to the developer or to any third party. WatchLink has no backend.
- Video data goes directly from Google to your device. It is never relayed to other participants or stored.
- Only the Drive file ID of the chosen video is shared with other room participants, so each of them can open it with their own access.
- You can unlink the account at any time in Settings, or revoke access at https://myaccount.google.com/permissions.

WatchLink's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Rooms

Room connections use WebRTC (encrypted by DTLS) discovered via public Nostr/MQTT relays. Your display name and avatar are visible to participants of the room you join.

## Contact

Open an issue in this repository.

---

WatchLink — это P2P-приложение для совместного просмотра без собственных серверов. Оно не собирает персональные данные. При привязке Google-аккаунта запрашивается доступ только на чтение к Диску: чтобы показать список ваших видео и воспроизвести выбранное на вашем устройстве. Токены хранятся только на вашем устройстве в защищённом хранилище, никуда не отправляются. Другим участникам комнаты передаётся только идентификатор файла. Отвязать аккаунт можно в настройках или на https://myaccount.google.com/permissions.
