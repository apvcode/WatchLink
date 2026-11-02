import fs from 'node:fs';
import ws from '../packages/core/node_modules/ws/index.js';

const WebSocketServer = ws.Server;

import { mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';

const relay = process.env.WATCHLINK_LOCAL_RELAY ? new WebSocketServer({ port: 8988 }) : null;
const subscribers = new Map();
const events = [];
function matches(event, filter) {
  return (
    (!filter.kinds || filter.kinds.includes(event.kind)) &&
    (!filter['#x'] ||
      event.tags.some(([key, value]) => key === 'x' && filter['#x'].includes(value)))
  );
}
relay?.on('connection', (socket) => {
  const subscriptions = new Map();
  subscribers.set(socket, subscriptions);
  socket.on('close', () => subscribers.delete(socket));
  socket.on('message', (raw) => {
    const [type, id, ...filters] = JSON.parse(raw.toString());
    if (type === 'REQ') {
      subscriptions.set(id, filters);
      for (const event of events)
        if (filters.some((f) => matches(event, f)))
          socket.send(JSON.stringify(['EVENT', id, event]));
      socket.send(JSON.stringify(['EOSE', id]));
    }
    if (type === 'CLOSE') subscriptions.delete(id);
    if (type === 'EVENT') {
      const event = id;
      events.push(event);
      if (events.length > 500) events.shift();
      socket.send(JSON.stringify(['OK', event.id, true, '']));
      for (const [client, subs] of subscribers)
        for (const [subscription, filters] of subs)
          if (filters.some((f) => matches(event, f)))
            client.send(JSON.stringify(['EVENT', subscription, event]));
    }
  });
});
const video = path.resolve('tests/fixtures/video.mp4');
const server = http.createServer((req, res) => {
  console.log('HTTP', req.url);
  if (req.url.startsWith('/video.mp4')) {
    const stat = fs.statSync(video);
    const [a, b] = (req.headers.range?.replace('bytes=', '') || '0-').split('-');
    const start = Number(a),
      end = b ? Number(b) : stat.size - 1;
    res.writeHead(206, {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(video, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<html><body style="margin:0;background:#000"><video style="width:100%;height:100vh" controls src="/video.mp4"></video></body></html>',
    );
  }
});
await new Promise((r) => server.listen(8999, '::', r));
const apps = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.WATCHLINK_SHOTS || '/tmp';
async function start(name) {
  const profile = await mkdtemp('/tmp/watchlink-e2e-');
  const app = await electron.launch({
    args: [path.resolve('apps/desktop/dist/main.js')],
    env: { ...process.env, WATCHLINK_PROFILE: profile },
  });
  apps.push(app);
  app.process().stdout.on('data', (d) => process.stdout.write(d));
  app.process().stderr.on('data', (d) => process.stdout.write(d));
  const ui = await app.firstWindow();
  ui.on('pageerror', (e) => console.log('UI_ERROR', e.message));
  // First launch: profile onboarding (nickname required, avatar optional).
  await ui.locator('#wl-nick').fill(name);
  await ui.locator('form button[type=submit]').click();
  await ui.waitForSelector('input[placeholder]');
  return { app, ui };
}
async function player(app, code) {
  return app.evaluate(({ webContents }, script) => {
    const wc = webContents
      .getAllWebContents()
      .find(
        (w) =>
          w.getURL().includes(':8999/') || w.getURL().startsWith('https://www.youtube.com/watch'),
      );
    if (!wc) return null;
    return wc.executeJavaScript(`(()=>{const v=document.querySelector('video');${script}})()`);
  }, code);
}
const wake = async (ui) => {
  await ui.mouse.move(300, 250);
  await ui.mouse.move(340, 280);
};
const shot = (name) => {
  try {
    execFileSync('grim', [`${SHOTS}/${name}.png`]);
  } catch {}
};

import { execFileSync } from 'node:child_process';

try {
  const a = await start('Alice');
  await a.ui
    .locator('form')
    .first()
    .locator('input')
    .fill(process.env.WATCHLINK_VIDEO_URL || 'http://127.0.0.1:8999/fixture');
  await a.ui.locator('form').first().locator('button[type=submit]').click();
  await expect
    .poll(() => player(a.app, 'return v?.readyState'), { timeout: 30000 })
    .toBeGreaterThan(1);
  console.log('PASS host actual player ready');
  await wake(a.ui);
  await a.ui.getByRole('button', { name: /^(Play|Смотреть)$/ }).click();
  await expect.poll(() => player(a.app, 'return v?.paused'), { timeout: 8000 }).toBe(false);
  await a.ui
    .getByTitle(/Copy invite|Копировать/)
    .first()
    .click();
  const invite = await a.app.evaluate(({ clipboard }) => clipboard.readText());
  if (!invite.startsWith('wl://')) throw Error('Invalid clipboard invitation');
  console.log('PASS host playing; waiting before late join');
  await sleep(9000);

  // LATE JOIN: the video has been running for several seconds already.
  const b = await start('Bob');
  await b.ui.locator('form').nth(1).locator('input').fill(invite);
  await b.ui.locator('form').nth(1).locator('button[type=submit]').click();
  if (!process.env.WATCHLINK_VIDEO_URL) {
    await expect(b.ui.getByRole('button', { name: /^(Open|Открыть)$/ })).toBeVisible({
      timeout: 45000,
    });
    await b.ui.getByRole('button', { name: /^(Open|Открыть)$/ }).click();
  }
  await expect
    .poll(() => player(b.app, 'return v?.readyState'), { timeout: 30000 })
    .toBeGreaterThan(1);
  console.log('PASS joiner actual player ready via WebRTC');
  await expect.poll(() => b.ui.locator('body').innerText(), { timeout: 15000 }).toContain('Alice');
  console.log('PASS joiner sees host profile name');
  await expect
    .poll(
      async () => {
        const [pa, pb, paused] = await Promise.all([
          player(a.app, 'return v.currentTime'),
          player(b.app, 'return v.currentTime'),
          player(b.app, 'return v.paused'),
        ]);
        console.log('LATE_JOIN host', pa?.toFixed(2), 'joiner', pb?.toFixed(2), 'paused', paused);
        return !paused && pa > 8 && Math.abs(pa - pb) < 0.8;
      },
      { timeout: 25000, intervals: [1000] },
    )
    .toBe(true);
  console.log('PASS late joiner caught up to the running video');
  await sleep(2500);
  shot('watchlink-late-join');

  await a.ui.getByRole('slider').fill('12');
  await a.ui.getByRole('slider').dispatchEvent('change');
  await expect
    .poll(() => player(b.app, 'return v?.currentTime'), { timeout: 6000 })
    .toBeGreaterThan(11);
  console.log('PASS seek propagated');
  // Guests cannot control playback: controls are disabled and a guest tap on the player does nothing.
  await wake(b.ui);
  await expect(b.ui.getByRole('button', { name: /^(Pause|Пауза)$/ })).toBeDisabled();
  await expect(b.ui.getByRole('slider')).toBeDisabled();
  await b.ui.mouse.click(300, 300);
  await sleep(800);
  if (await player(a.app, 'return v?.paused')) throw Error('guest tap changed host playback');
  console.log('PASS guest controls disabled; tapping the player does nothing');
  await wake(a.ui);
  await a.ui.getByRole('button', { name: /^(Pause|Пауза)$/ }).click();
  await expect.poll(() => player(b.app, 'return v?.paused'), { timeout: 5000 }).toBe(true);
  console.log('PASS host pause propagated');
  await a.ui.mouse.click(300, 300);
  await sleep(800);
  if (!(await player(a.app, 'return v?.paused')))
    throw Error('tapping the player resumed playback');
  console.log('PASS tapping the player does not toggle playback');
  await wake(a.ui);
  await a.ui.getByRole('button', { name: /^(Play|Смотреть)$/ }).click();
  await expect.poll(() => player(b.app, 'return v?.paused'), { timeout: 5000 }).toBe(false);
  console.log('PASS play propagated');
  await sleep(3000);
  const positions = await Promise.all([
    player(a.app, 'return v.currentTime'),
    player(b.app, 'return v.currentTime'),
  ]);
  console.log('PLAYBACK_DRIFT_MS', Math.abs(positions[0] - positions[1]) * 1000);

  // Chat with profile names.
  await b.ui.getByPlaceholder(/Message|Сообщение/).fill('hello from Bob');
  await b.ui.getByPlaceholder(/Message|Сообщение/).press('Enter');
  await expect
    .poll(() => a.ui.locator('body').innerText(), { timeout: 8000 })
    .toContain('hello from Bob');
  console.log('PASS chat delivered');

  if (process.env.WATCHLINK_VIDEO_URL?.includes('youtube')) {
    await wake(a.ui);
    await a.ui
      .getByRole('button', { name: /^(Settings|Настройки)$/ })
      .last()
      .click();
    await a.ui.getByRole('button', { name: /Video quality|Качество/ }).click();
    const items = await a.ui.locator('.menu-item').allInnerTexts();
    console.log('QUALITY_MENU', JSON.stringify(items));
    const target = a.ui.locator('.menu-item', { hasText: /^(360p|240p)/ }).first();
    await target.click();
    await sleep(4000);
    const actual = await a.app.evaluate(({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('youtube.com'));
      return wc?.executeJavaScript(
        "document.getElementById('movie_player')?.getPlaybackQuality?.()",
      );
    });
    console.log('QUALITY_ACTUAL', actual);
    if (!['medium', 'small'].includes(actual)) throw Error(`quality did not change: ${actual}`);
    console.log('PASS quality selection applied');
  }
  shot('watchlink-final');
  await a.ui.screenshot({ path: `${SHOTS}/watchlink-e2e-host.png` });
  await b.ui.screenshot({ path: `${SHOTS}/watchlink-e2e-joiner.png` });
} finally {
  for (const app of apps) await app.close();
  server.close();
  relay?.close();
}
