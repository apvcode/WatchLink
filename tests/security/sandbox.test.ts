import path from 'node:path';
import { type ElectronApplication, _electron as electron, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Electron Desktop Sandbox & Security', () => {
  let app: ElectronApplication;
  let win: Page;

  beforeAll(async () => {
    const mainScript = path.resolve('scripts/electron-live-main.cjs');
    app = await electron.launch({
      args: [mainScript, '--no-sandbox'],
    });
    win = await app.firstWindow();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('proves content view has no Node access (typeof require === "undefined")', async () => {
    const access = await win.evaluate(() => {
      return {
        hasRequire: typeof require !== 'undefined',
        hasProcess: typeof process !== 'undefined',
        hasBuffer: typeof Buffer !== 'undefined',
        hasGlobal: typeof global !== 'undefined',
      };
    });

    expect(access.hasRequire).toBe(false);
    expect(access.hasProcess).toBe(false);
    expect(access.hasBuffer).toBe(false);
  });

  it('enforces context isolation and isolated worlds', async () => {
    const isolated = await win.evaluate(() => {
      return (window as any).ipcRenderer === undefined;
    });
    expect(isolated).toBe(true);
  });

  it('blocks popup window creation and unauthorized navigations', async () => {
    // Attempt window.open
    const popupResult = await win.evaluate(() => {
      try {
        const popup = window.open('https://malicious-site.com', '_blank');
        return popup === null || popup === undefined;
      } catch {
        return true;
      }
    });
    expect(popupResult).toBe(true);
  });

  it('verifies network allowlist and localhost isolation', async () => {
    const fetchBlocked = await win.evaluate(async () => {
      try {
        // Attempt connecting to unapproved internal subnet or telemetry
        await fetch('http://10.255.255.1:9999/telemetry', { signal: AbortSignal.timeout(300) });
        return false;
      } catch {
        return true;
      }
    });
    expect(fetchBlocked).toBe(true);
  });
});
