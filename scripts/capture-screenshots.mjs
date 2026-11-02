#!/usr/bin/env node

/**
 * WatchLink Screenshot Generator
 * Generates screenshots of ALL application states across Desktop and Android resolutions
 * in both English and Russian, per Phase 4 Design QA requirements.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const UI_HTML = path.join(ROOT_DIR, 'packages/ui/dist/index.html');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, 'docs/screenshots');

const DESKTOP_VIEWPORTS = [
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1024x700', width: 1024, height: 700 },
  { name: '900x600', width: 900, height: 600 },
];

const ANDROID_VIEWPORTS = [
  { name: '412x915-portrait', width: 412, height: 915 },
  { name: '915x412-landscape', width: 915, height: 412 },
];

const STATES = [
  'home',
  'waiting',
  'room-active',
  'settings',
  'no-video',
  'signaling-failure',
  'room-full',
  'consent',
  'buffering',
];

const LANGUAGES = ['en', 'ru'];

async function capture() {
  console.log('====================================================');
  console.log(' WatchLink Design QA — Capturing All Visual States');
  console.log('====================================================\n');

  const app = await electron.launch({
    args: [path.resolve(ROOT_DIR, 'scripts/electron-live-main.cjs'), '--no-sandbox'],
  });

  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.show();
  });

  let count = 0;

  // 1. Desktop Screenshots
  console.log('--> Capturing Desktop States (1280x800, 1024x700, 900x600)...');
  for (const vp of DESKTOP_VIEWPORTS) {
    await win.setViewportSize({ width: vp.width, height: vp.height });

    for (const state of STATES) {
      for (const lang of LANGUAGES) {
        const url = `file://${UI_HTML}?state=${state}&lang=${lang}&debug=true`;
        await win.goto(url);
        await win.waitForTimeout(150);

        const filename = `desktop_${vp.name}_${state}_${lang}.png`;
        const filepath = path.join(SCREENSHOTS_DIR, 'desktop', filename);
        await win.screenshot({ path: filepath, timeout: 5000 });
        count++;
      }
    }
    console.log(`    ✓ Completed ${vp.name} (${STATES.length * LANGUAGES.length} states)`);
  }

  // 2. Android Screenshots
  console.log('\n--> Capturing Android Mobile States (412x915 portrait, 915x412 landscape)...');
  for (const vp of ANDROID_VIEWPORTS) {
    await win.setViewportSize({ width: vp.width, height: vp.height });

    for (const state of STATES) {
      for (const lang of LANGUAGES) {
        const url = `file://${UI_HTML}?state=${state}&lang=${lang}&mobile=true`;
        await win.goto(url);
        await win.waitForTimeout(150);

        const filename = `android_${vp.name}_${state}_${lang}.png`;
        const filepath = path.join(SCREENSHOTS_DIR, 'android', filename);
        await win.screenshot({ path: filepath, timeout: 5000 });
        count++;
      }
    }
    console.log(`    ✓ Completed ${vp.name} (${STATES.length * LANGUAGES.length} states)`);
  }

  await app.close();
  console.log(`\n====================================================`);
  console.log(`✓ Total screenshots captured: ${count}`);
  console.log(`Saved to: ${SCREENSHOTS_DIR}`);
  console.log('====================================================\n');
}

capture().catch((err) => {
  console.error('Fatal capture error:', err);
  process.exit(1);
});
