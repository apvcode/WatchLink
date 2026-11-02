import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const out = 'apps/desktop/dist';
// Optional local config (.env is git-ignored). Missing file or keys just disable Google linking.
const env = { ...process.env };
try {
  for (const line of (await readFile('.env', 'utf8')).split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !line.trimStart().startsWith('#') && !(match[1] in env)) env[match[1]] = match[2];
  }
} catch {}
// Start clean: hashed UI bundles from every earlier build otherwise pile up and get packaged.
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/ui`, { recursive: true });
await build({
  absWorkingDir: process.cwd(),
  entryPoints: ['apps/desktop/src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['electron'],
  outfile: `${out}/main.js`,
  define: {
    __GOOGLE_CLIENT_ID__: JSON.stringify(env.WATCHLINK_GOOGLE_DESKTOP_CLIENT_ID ?? ''),
    __GOOGLE_CLIENT_SECRET__: JSON.stringify(env.WATCHLINK_GOOGLE_DESKTOP_CLIENT_SECRET ?? ''),
  },
});
for (const name of ['preload-ui', 'preload-content']) {
  await build({
    absWorkingDir: process.cwd(),
    entryPoints: [`apps/desktop/src/${name}.ts`],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: `${out}/${name}.cjs`,
  });
}
await cp('packages/ui/dist', `${out}/ui`, { recursive: true });
await cp('packaging/icon/icon.png', `${out}/icon.png`);
