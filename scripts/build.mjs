#!/usr/bin/env node
// Build the rail panel (IIFE, browser) and the service (ESM, node22) into
// dist/. OpenChamber never compiles TypeScript: dist/ is committed and shipped.
import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

async function main() {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const define = { __GIT_LOG_VERSION__: JSON.stringify(pkg.version) };

  await rm(dist, { recursive: true, force: true });
  await mkdir(path.join(dist, 'panel'), { recursive: true });
  await mkdir(path.join(dist, 'service'), { recursive: true });

  await build({
    absWorkingDir: root,
    entryPoints: ['src/panel/main.ts'],
    outfile: 'dist/panel/main.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120', 'safari16'],
    legalComments: 'none',
    define,
    logLevel: 'info',
  });

  await build({
    absWorkingDir: root,
    entryPoints: ['src/service/main.ts'],
    outfile: 'dist/service/main.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    legalComments: 'none',
    define,
    logLevel: 'info',
  });

  for (const file of await readdir(path.join(root, 'src', 'panel'))) {
    if (!file.endsWith('.html') && !file.endsWith('.css')) continue;
    await cp(path.join(root, 'src', 'panel', file), path.join(dist, 'panel', file));
  }

  console.log('built dist/panel/index.html, dist/panel/main.js and dist/service/main.js');
}

await main();
