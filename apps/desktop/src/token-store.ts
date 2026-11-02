import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type { StoredTokens, TokenStore } from './google-auth.js';

/**
 * Keeps the Google refresh token on this device only. It is encrypted with the OS keyring
 * (libsecret / kwallet on Linux, DPAPI on Windows) when one is available; without a keyring the
 * file falls back to owner-only permissions.
 */
export function fileTokenStore(name = 'google-account.bin'): TokenStore {
  const file = () => path.join(app.getPath('userData'), name);
  return {
    async load() {
      try {
        const raw = await readFile(file());
        const text =
          raw[0] === 0x01 && safeStorage.isEncryptionAvailable()
            ? safeStorage.decryptString(raw.subarray(1))
            : raw[0] === 0x00
              ? raw.subarray(1).toString('utf8')
              : null;
        return text ? (JSON.parse(text) as StoredTokens) : null;
      } catch {
        return null;
      }
    },
    async save(tokens) {
      const json = JSON.stringify(tokens);
      const data = safeStorage.isEncryptionAvailable()
        ? Buffer.concat([Buffer.from([0x01]), safeStorage.encryptString(json)])
        : Buffer.concat([Buffer.from([0x00]), Buffer.from(json, 'utf8')]);
      await mkdir(path.dirname(file()), { recursive: true });
      await writeFile(file(), data, { mode: 0o600 });
      await chmod(file(), 0o600).catch(() => undefined);
    },
    async clear() {
      await rm(file(), { force: true });
    },
  };
}
