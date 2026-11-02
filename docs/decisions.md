# Architecture & Technical Decision Records (ADRs)

This document records key decisions, trials, and fallbacks taken during the implementation of WatchLink according to the rules of engagement.

---

## D1: YouTube Adapter Strategy
- **Status:** DECIDED & VERIFIED (Phase 2 live-check)
- **Primary approach:** Direct DOM-level video adapter running inside the sandboxed content view loading standard YouTube watch URLs (`https://www.youtube.com/watch?v=...`). It hooks SPA transitions via `yt-navigate-finish` on `window` and detects ads through `#movie_player.ad-showing` and overlay classes. When ads play, `adPlaying: true` is reported and drift enforcement / programmatic seeks are suppressed.
- **Fallback approach:** Local embedded iframe player using YouTube IFrame Player API.
- **Trial outcome:**
  - YouTube embeds (`https://www.youtube.com/embed/<id>`) enforce strict referer checks: loading embeds from non-HTTPS origins (such as `file://`, custom protocol schemes, or requests without a valid HTTP/HTTPS referer) yields Error 150/153 (embedding restricted / origin not allowed).
  - Loading standard YouTube watch pages directly inside Electron's sandboxed `WebContentsView` with `session.registerPreloadScript({ type: 'frame' })` completely avoids the referer restriction, provides access to full video stream resolutions, and cleanly hooks `.html5-main-video` and SPA navigation.
  - When embedding is required, a valid `Referer: https://www.youtube.com` header must be injected.
  - Verification: Confirmed via `scripts/live-check.mjs` in real Electron 35.

---

## D2: Frame Injection in Electron Desktop Shell
- **Status:** DECIDED & VERIFIED (Phase 2 live-check)
- **Primary approach:** `session.defaultSession.registerPreloadScript({ type: 'frame', filePath: ... })` to inject the unified content adapter bundle (`content-bridge.global.js`) across all content frames at document start.
- **Fallback approach:** Dynamic injection via `webContents.mainFrame.on('frame-created')` and `webFrameMain.executeJavaScriptInIsolatedWorld`.
- **Trial outcome:**
  - Electron 35 supports `registerPreloadScript({ type: 'frame', filePath: ... })` natively.
  - Tested on nested subframe structures (such as VK Video iframes and embeds). The preload script executes automatically inside nested subframes, binds to the inner `<video>` element, and communicates across frame boundaries without leaking Node access (`typeof require === 'undefined'`).
  - Primary approach adopted as official architecture.

---

## D3: Google Drive Source Adapter
- **Status:** DECIDED & VERIFIED (Phase 2 live-check)
- **Primary approach:** Auto-transform Google Drive share links (`/file/d/<id>/view` or `open?id=<id>`) to the preview format `drive.google.com/file/d/<id>/preview`. Detect `.drive-viewer-video-player` and bind to the inner HTML5 `<video>` element.
- **Fallback approach:** If a file is private or requires Google account authentication / exceeds quota, the adapter reports honest status to UI indicating restricted access.
- **Trial outcome:**
  - The preview URL format successfully renders the HTML5 video player container.
  - The adapter resolves the video stream and controls playback, seek, and rate.
  - Primary approach verified in `scripts/live-check.mjs`.

---

## D4: Signaling Fallback (Nostr -> MQTT)
- **Status:** IMPLEMENTED & VERIFIED (Phase 1)
- **Primary approach:** Trystero Nostr strategy (`@trystero-p2p/nostr`). Connect to default Nostr relays with room password encryption.
- **Fallback approach:** If no relay connects within 8 seconds, fail over to MQTT strategy (`@trystero-p2p/mqtt`).
- **Trial outcome:** Implemented in `@watchlink/core/room.ts`. DTLS data channel encryption is maintained on both transports.

---

## D5: Android Dual-View Messaging Interface
- **Status:** DESIGNED (Phase 0 / Phase 5)
- **Primary approach:** `androidx.webkit.WebViewCompat.addWebMessageListener` and `addDocumentStartJavaScript` for secure frame injection and bidirectional JSON messaging without exposing Java reflection objects to untrusted web content.
- **Fallback approach:** `addJavascriptInterface` exposed strictly to the trusted local UI view, never to the untrusted content view.
- **Trial outcome:** To be verified on device in Phase 5.
