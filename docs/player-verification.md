# WatchLink player verification — 2026-11-01

The normal UI now uses WatchLink playback controls (play/pause, seek, speed and fullscreen). YouTube's playback engine runs in the isolated content view; only the video surface is presented. This is not a direct-stream extractor or a claim about Rave's implementation. Optional YouTube cookies are declined when its consent dialog blocks playback.

## Verified

- Strict TypeScript checks across the four workspace packages pass.
- 53 automated tests pass, including transport action-object API, identity validation, fallback lifecycle and cleanup.
- The actual Electron app loaded `https://www.youtube.com/watch?v=AhBlQCQ6x0w` (481.201 seconds), and WatchLink's Play button started playback.
- Two independent Electron processes connected through WebRTC with a local test Nostr relay. On both the HTML5 fixture and the real YouTube source, WatchLink seek/play/pause propagated to the other player.
- In the YouTube run, the sampled playback-position difference after three seconds was 130.834 ms. This is a single observation, not a percentile or a guarantee.
- Android debug APK builds successfully. Installation and launch via ADB were previously verified on the connected RMX5078 phone; current phone playback and cross-platform synchronization still require verification.

## Reproduce the two-client YouTube test

```bash
VITE_WATCHLINK_TEST_RELAY=ws://127.0.0.1:8988 pnpm --filter @watchlink/ui build
node scripts/build-desktop.mjs
WATCHLINK_LOCAL_RELAY=1 WATCHLINK_VIDEO_URL='https://www.youtube.com/watch?v=AhBlQCQ6x0w' node scripts/e2e-desktop.mjs
# Restore ordinary builds using public signaling:
pnpm run build
```

The relay is test infrastructure only; ordinary builds contain no configured local relay address. Public signaling and Linux-to-Android synchronization have not passed the acceptance test yet. An earlier public-relay run failed to connect within the test timeout.

A host firewall that blocks the Electron executable (including loopback connections) leaves the video view blank. The application now has a loading indicator and a 20-second navigation timeout instead of an indefinite white surface. Tests do not disable the system firewall or Electron sandbox.

The older acceptance report describes the previous implementation and is not evidence that the current release is complete.

## Surface regression fix

The earlier YouTube presentation could leave the masthead and recommendations above the video because ancestor stacking contexts contained the fixed-position player. The presentation now hides unrelated page elements and removes transforms/containment on the active video's ancestors. A real Electron check asserts that the masthead and recommendations have hidden visibility, the player matches the entire content viewport, and playback continues after window-size changes. Captures at both tested layouts were visually inspected; both show only video (with letterboxing where appropriate).

## UI redesign, profiles, late join, quality (2026-11-01)

- New black/monochrome interface with blur glass surfaces. The video is a native view *under* a transparent UI page, so playback controls (±10 s, play/pause, seek, speed, quality, fullscreen) overlay the video on desktop and Android alike.
- First launch asks for a nickname (required) and an avatar (optional, downscaled to ≤5 KB). A random 128-bit device ID is created with the profile; it is sent to peers for recognition (a re-joining device replaces its ghost entry) and is never displayed except as the last 4 characters in the owner's own settings. It is not cryptographically signed, so it identifies but does not authenticate.
- Late join fix: the clock leader was the lexicographically lowest random peer id, so a newcomer could take over leadership with no room state. The leader is now pinned to the established host, only the leader answers a hello with state, and the newcomer re-aligns (`resync`) once its player is ready and again after the clock converges. Covered by `late-join.test.ts` and by the real two-Electron test (`scripts/e2e-desktop.mjs`): a client joining 9 s into playback was within 0.1 s of the host a few seconds later, on both the HTML5 fixture and YouTube.
- Quality selection (YouTube): menu lists the levels the player offers; verified in Electron that choosing 360p changed `getPlaybackQuality()`. Quality is per-device and not synchronised. Other sources show Auto only.
- Not yet re-verified after the redesign: Android on the physical phone (APK built, not installed because the phone was unplugged) and YouTube drift percentiles (one sample after a play command showed 1.6 s, the fixture run showed ~1 ms).
- Android debug builds on this machine need `JAVA_HOME=~/.jdks/jdk-21`; the system JDK 27's `jlink` fails the AGP JDK-image transform.
