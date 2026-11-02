/** Keep the origin's playback engine and expose only its video surface. */
export function installVideoSurface(win: Window): void {
  if (!['http:', 'https:'].includes(win.location.protocol)) return;
  const doc = win.document;
  if (doc.getElementById('watchlink-video-surface')) return;
  const style = doc.createElement('style');
  style.id = 'watchlink-video-surface';
  const youtube = /(^|\.)youtube\.com$/.test(win.location.hostname);
  style.textContent = youtube
    ? `
    html,body {margin:0!important;padding:0!important;overflow:hidden!important;background:#000!important;}
    body * {visibility:hidden!important;}
    [data-watchlink-parent] {visibility:visible!important;transform:none!important;contain:none!important;filter:none!important;perspective:none!important;clip-path:none!important;overflow:visible!important;}
    video {visibility:visible!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;object-fit:contain!important;transform:none!important;pointer-events:none!important;opacity:1!important;z-index:2147483647!important;}
    #movie_player {visibility:visible!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483647!important;background:#000!important;transform:none!important;isolation:isolate!important;overflow:hidden!important;}
    #movie_player .html5-video-container {visibility:visible!important;position:absolute!important;inset:0!important;width:100vw!important;height:100vh!important;}
    #movie_player video {visibility:visible!important;position:absolute!important;inset:0!important;width:100vw!important;height:100vh!important;object-fit:contain!important;transform:none!important;pointer-events:none!important;opacity:1!important;}
    #movie_player > :not(.html5-video-container) {display:none!important;}
  `
    : `
    html, body { margin:0!important; padding:0!important; overflow:hidden!important; background:#000!important; }
    body * { visibility:hidden!important; }
    [data-watchlink-parent] { visibility:visible!important; transform:none!important; contain:none!important; overflow:visible!important; }
    video { visibility:visible!important; position:fixed!important; inset:0!important;
      width:100vw!important; height:100vh!important; max-width:none!important; max-height:none!important;
      object-fit:contain!important; z-index:2147483647!important; pointer-events:none!important;
      transform:none!important; opacity:1!important; background:#000!important; }
    iframe { visibility:visible!important; position:fixed!important; inset:0!important;
      width:100vw!important; height:100vh!important; border:0!important; }
  `;
  (doc.head ?? doc.documentElement).append(style);
  const removeControls = () => {
    const videos = youtube
      ? [
          doc.querySelector<HTMLVideoElement>('#movie_player video') ??
            doc.querySelector<HTMLVideoElement>('video'),
        ].filter((video): video is HTMLVideoElement => Boolean(video))
      : [...doc.querySelectorAll<HTMLVideoElement>('video')];
    for (const video of videos) {
      if (video.controls) video.controls = false;
      let parent = video.parentElement;
      while (parent && parent !== doc.body) {
        if (!parent.hasAttribute('data-watchlink-parent'))
          parent.setAttribute('data-watchlink-parent', '');
        parent = parent.parentElement;
      }
    }
  };
  removeControls();
  const observer = new MutationObserver(removeControls);
  observer.observe(doc.documentElement, { subtree: true, childList: true });
  win.addEventListener('pagehide', () => observer.disconnect(), { once: true });
}
