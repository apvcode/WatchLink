// Phone is the HOST (already in a room with a YouTube video, devtools forwarded on :9223),
// a desktop instance joins as guest. Toggles fullscreen on the phone and checks that the host
// video keeps playing, that Play still works afterwards and that the guest stays in sync.
//   adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>
//   node scripts/phone-fullscreen-check.mjs
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { phoneEvaluate } from './phone-cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phoneVideo = () =>
  phoneEvaluate(
    'content',
    `JSON.stringify((()=>{const v=document.querySelector('video');return v&&{paused:v.paused,t:Math.round(v.currentTime*10)/10,rs:v.readyState}})())`,
  ).then(JSON.parse);
const phoneUi = (js) => phoneEvaluate('ui', js);
const phoneClick = (sel) =>
  phoneUi(
    `(()=>{const a=document.getElementById('watchlink-content-view-area');a?.dispatchEvent(new PointerEvent('pointermove',{bubbles:true}));const b=document.querySelector(${JSON.stringify(sel)});b?.click();return !!b})()`,
  );

const invite = await phoneUi(
  `[...document.querySelectorAll('*')].map(e=>e.children.length?'':e.textContent.trim()).find(t=>t.startsWith('wl://'))||''`,
);
if (!invite.startsWith('wl://')) throw Error('Phone is not in a room (no invite found)');
const app = await electron.launch({
  args: [path.resolve('apps/desktop/dist/main.js')],
  env: { ...process.env, WATCHLINK_PROFILE: await mkdtemp('/tmp/watchlink-fs-') },
});
let ui;
for (let i = 0; i < 100 && !ui; i++) {
  ui = app
    .context()
    .pages()
    .find((p) => p.url().includes('/ui/index.html'));
  await sleep(100);
}
const guest = () =>
  app.evaluate(async ({ webContents }) => {
    const wc = webContents
      .getAllWebContents()
      .find((w) => w.getURL().includes('youtube.com/watch'));
    return wc
      ? wc.executeJavaScript(
          `(()=>{const v=document.querySelector('video');return v&&{paused:v.paused,t:Math.round(v.currentTime*10)/10,rs:v.readyState,ns:v.networkState,err:v.error&&v.error.code,buf:v.buffered.length&&v.buffered.end(0),src:(v.currentSrc||'').slice(0,20),ad:!!document.querySelector('.ad-showing'),vw:v.videoWidth}})()`,
        )
      : null;
  });
if (process.env.TRACE) {
  await phoneEvaluate(
    'content',
    `(()=>{Error.stackTraceLimit=40;window.__p=[];const P=HTMLMediaElement.prototype;if(window.__pt)return;window.__pt=1;const op=P.pause;P.pause=function(){window.__p.push([Math.round(Date.now()%100000),new Error().stack.split('\\n').slice(2,12).map(l=>l.trim().replace(/https:[^ ]*\\//,'')).join(' < ')]);return op.call(this)};})()`,
  );
  await phoneUi(
    `(()=>{if(window.__hl)return 1;window.__hl=[];const o=window.WatchLinkHost.postMessage.bind(window.WatchLinkHost);window.WatchLinkHost.postMessage=(m)=>{if(!m.includes('getState')&&!m.includes('bounds'))window.__hl.push([Math.round(Date.now()%100000),'OUT',m.slice(0,120)]);return o(m)};window.addEventListener('message',e=>{const d=e.data;if(d&&d.type==='watchlink:event')window.__hl.push([Math.round(Date.now()%100000),'EV',JSON.stringify(d.event).slice(0,140)])});return 1})()`,
  );
}
const fails = [];
const check = (name, ok, detail) => {
  console.log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
  if (!ok) fails.push(name);
};
try {
  await ui.locator('#wl-nick').fill('Desktop');
  await ui.locator('form button[type=submit]').click();
  await ui.waitForSelector('#wl-nick', { state: 'detached' });
  await sleep(1000);
  await ui.locator('button[aria-expanded]').first().click();
  await sleep(400);
  await ui.locator('form').nth(1).locator('input:not(.sr)').fill(invite);
  await ui.locator('form').nth(1).locator('button[type=submit]').click();
  for (let i = 0; i < 40 && !(await guest()); i++) await sleep(1000);
  await sleep(8000);
  check('guest joined', Boolean(await guest()));

  const state = async (label) => {
    const [p, g] = [await phoneVideo(), await guest()];
    console.log(label, 'phone', JSON.stringify(p), 'guest', JSON.stringify(g));
    return [p, g];
  };
  if (process.env.SOAK) {
    for (let i = 0; i < 20; i++) {
      await sleep(2000);
      await state(`soak ${i * 2}s`);
    }
  }
  // Make sure the host is playing.
  if ((await phoneVideo()).paused) await phoneClick('.big-play');
  await sleep(5000);
  let [p, g] = await state('playing');
  check('host playing', p && !p.paused);
  check('guest playing', g && !g.paused);

  await phoneClick('button[aria-label="Fullscreen"]');
  await sleep(6000);
  [p, g] = await state('fullscreen');
  check('host keeps playing in fullscreen', p && !p.paused);
  check('guest keeps playing in fullscreen', g && !g.paused);
  check('in sync (fullscreen)', p && g && Math.abs(p.t - g.t) < 3, `${p?.t} vs ${g?.t}`);

  await phoneUi(`(()=>{window.postMessage({type:'watchlink:host:back'},'*');return 1})()`);
  await sleep(6000);
  [p, g] = await state('after exit');
  check('host keeps playing after exit', p && !p.paused);
  check('guest keeps playing after exit', g && !g.paused);
  check('in sync (after exit)', p && g && Math.abs(p.t - g.t) < 3, `${p?.t} vs ${g?.t}`);

  // Pause then play again from the phone: Play must work after fullscreen.
  await phoneClick('.big-play');
  await sleep(3000);
  [p, g] = await state('paused');
  check('pause propagates', p?.paused && g?.paused);
  await phoneClick('.big-play');
  await sleep(14000); // a buffering hold (up to 5 s) may delay the resume
  [p, g] = await state('play again');
  check('play works again on host', p && !p.paused);
  check('play reaches guest', g && !g.paused);
  check('in sync (replay)', p && g && Math.abs(p.t - g.t) < 3, `${p?.t} vs ${g?.t}`);
  if (process.env.TRACE) {
    console.log('PAUSE CALLS', await phoneEvaluate('content', 'JSON.stringify(window.__p)'));
    console.log('UI LOG', await phoneUi('JSON.stringify(window.__hl)'));
  }
} finally {
  await app.close();
}
if (fails.length) {
  console.log('FAILED:', fails.join(', '));
  process.exit(1);
}
console.log('ALL PASS');
