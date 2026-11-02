import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const out = 'apps/desktop/dist';
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
