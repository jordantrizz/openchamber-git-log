#!/usr/bin/env node
// Check what Settings -> Extensions checks on install, without the host:
// the manifest parses, it declares one panel and one service, and every file
// the manifest names is on disk as built JavaScript or an existing SVG.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const problems = [];
const builtFiles = [];

/** Newest mtime under a source tree, ignoring generated and vendored folders. */
const newestMtime = async (target) => {
  let info;
  try {
    info = await stat(target);
  } catch {
    return 0;
  }
  if (info.isFile()) return info.mtimeMs;

  let newest = 0;
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    newest = Math.max(newest, await newestMtime(path.join(target, entry.name)));
  }
  return newest;
};

const read = async (rel) => {
  try {
    return await readFile(path.join(root, rel), 'utf8');
  } catch {
    problems.push(`missing file: ${rel}`);
    return null;
  }
};

const exists = async (rel) => {
  try {
    const info = await stat(path.join(root, rel));
    if (!info.isFile()) problems.push(`not a file: ${rel}`);
    return info.isFile();
  } catch {
    problems.push(`missing file: ${rel}`);
    return false;
  }
};

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = pkg.openchamber ?? {};
const contributes = manifest.contributes ?? {};

if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(String(pkg.version ?? ''))) {
  problems.push(`package.json version is not semver: ${pkg.version}`);
}
if (manifest.apiVersion !== 1) problems.push(`apiVersion must be 1, got ${manifest.apiVersion}`);
if (contributes.page) problems.push('this extension is panel-only: contributes.page is not allowed');
if (contributes.statusSection) {
  problems.push('this extension is panel-only: contributes.statusSection is not allowed');
}
if (contributes.background) problems.push('this extension is panel-only: contributes.background is not allowed');
if (contributes.capabilities?.length) {
  problems.push(`this extension declares no capabilities: ${contributes.capabilities.join(', ')}`);
}

const panel = contributes.panel;
if (!panel) {
  problems.push('contributes.panel is required');
} else {
  if (panel.id !== 'git-log') problems.push(`panel id must stay "git-log", got ${panel.id}`);
  if (!panel.entry?.endsWith('.html')) {
    problems.push(`panel entry must be .html: ${panel.entry}`);
  } else {
    const html = await read(panel.entry);
    if (html) {
      for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
        const src = match[1];
        if (/^[a-z]+:|^\/\//i.test(src)) {
          problems.push(`external script is not allowed in ${panel.entry}: ${src}`);
          continue;
        }
        const built = path.posix.join(path.posix.dirname(panel.entry), src.replace(/^\.\//, ''));
        builtFiles.push(built);
        await exists(built);
      }
    }
  }
  if (typeof panel.icon === 'string' && panel.icon.endsWith('.svg')) await exists(panel.icon);
}

if (!contributes.service) {
  problems.push('contributes.service is required');
} else {
  if (contributes.service.runtime !== 'host') problems.push('service.runtime must be "host"');
  if (!contributes.service.entry?.endsWith('.js')) {
    problems.push(`service.entry must be built .js: ${contributes.service.entry}`);
  } else {
    builtFiles.push(contributes.service.entry);
    await exists(contributes.service.entry);
  }
  const exec = contributes.service.permissions?.exec ?? [];
  if (!Array.isArray(exec) || exec.length !== 1 || exec[0] !== 'git') {
    problems.push(`service.permissions.exec must be exactly ["git"], got ${JSON.stringify(exec)}`);
  }
}

const sourceTime = Math.max(
  await newestMtime(path.join(root, 'src')),
  await newestMtime(path.join(root, 'package.json')),
  await newestMtime(path.join(root, 'scripts', 'build.mjs')),
);
for (const file of builtFiles) {
  try {
    const info = await stat(path.join(root, file));
    if (sourceTime > info.mtimeMs + 1000) {
      problems.push(`dist/ is older than src/ (${file}); run npm run build and commit dist/`);
    }
  } catch {
    // The missing-file problem was already recorded above.
  }
}

if (problems.length > 0) {
  console.error(`package check failed (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`package ok: ${pkg.name}@${pkg.version} (panel ${panel.id})`);
