import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { baseEnv } from '../src/service/exec.ts';
import {
  buildGitArgs,
  GIT_VECTORS,
  isAllowedGitVector,
  readGit,
  resolveGitBinary,
} from '../src/service/git.ts';
import { LOG_CAP } from '../src/shared/parse-log.ts';
import { parseStatus } from '../src/shared/parse-status.ts';
import { git, initRepo, makeTempDir } from './helpers.ts';

test('five fixed vectors, every one read-only and none parameterised', () => {
  assert.equal(GIT_VECTORS.length, 5);
  for (const vector of GIT_VECTORS) {
    assert.equal(vector[0], '--no-optional-locks');
  }
  const log = buildGitArgs('log');
  assert.equal(isAllowedGitVector(log), true);
  assert.equal(log.includes(`--max-count=${LOG_CAP}`), true);
  assert.equal(isAllowedGitVector([...log, '--all']), false);
  assert.equal(isAllowedGitVector([...buildGitArgs('status'), 'unstaged']), false);
  assert.equal(isAllowedGitVector([]), false);
});

test('a missing binary is one muted notice, not a crash', async () => {
  const read = await readGit('/tmp', { binary: null });
  assert.equal(read.state, 'unavailable');
  if (read.state === 'unavailable') assert.equal(read.notice.code, 'git-missing');
});

test('a directory that is not a repository is an ordinary state', async () => {
  const directory = await makeTempDir();
  try {
    const read = await readGit(directory);
    assert.equal(read.state, 'not-repo');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a real checkout answers without changing status or refs', async () => {
  const directory = await initRepo();
  try {
    await writeFile(path.join(directory, 'tracked.txt'), 'two\n', 'utf8');
    await writeFile(path.join(directory, 'new.txt'), 'new\n', 'utf8');

    const statusBefore = await git(directory, ['status', '--porcelain=v2', '--branch']);
    const refsBefore = await git(directory, ['for-each-ref']);

    const read = await readGit(directory);
    assert.equal(read.state, 'ok');
    if (read.state !== 'ok') return;
    const status = parseStatus(read.answers.status.stdout);
    assert.equal(status.head.branch, 'main');
    assert.equal(status.counts.modified, 1);
    assert.equal(status.counts.untracked, 1);
    assert.match(read.answers.log.stdout, /init/u);
    assert.match(read.answers.branches.stdout, /refs\/heads\/main/u);
    assert.match(read.answers.worktrees.stdout, /branch refs\/heads\/main/u);

    assert.equal(await git(directory, ['status', '--porcelain=v2', '--branch']), statusBefore);
    assert.equal(await git(directory, ['for-each-ref']), refsBefore);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an empty repository answers with an unborn branch and no commits', async () => {
  const directory = await makeTempDir();
  try {
    await git(directory, ['init', '-q', '-b', 'main']);
    const read = await readGit(directory);
    assert.equal(read.state, 'ok');
    if (read.state !== 'ok') return;
    const status = parseStatus(read.answers.status.stdout);
    assert.equal(status.head.unborn, true);
    assert.equal(status.head.branch, 'main');
    assert.equal(read.answers.log.ok, false);
    assert.match(read.answers.log.stderr, /does not have any commits yet|bad default revision/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a root timeout becomes one warning', async () => {
  const read = await readGit('/tmp', {
    binary: { path: '/bin/true', source: 'path' },
    run: async () => ({
      ok: false,
      exitCode: null,
      signal: 'SIGKILL',
      stdout: '',
      stderr: '',
      timedOut: true,
      truncated: false,
      error: null,
    }),
  });
  assert.equal(read.state, 'unavailable');
  if (read.state === 'unavailable') assert.equal(read.notice.code, 'git-timeout');
});

test('a spawn failure becomes one warning', async () => {
  const read = await readGit('/tmp', {
    binary: { path: '/bin/false', source: 'path' },
    run: async () => ({
      ok: false,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      truncated: false,
      error: 'spawn ENOENT',
    }),
  });
  assert.equal(read.state, 'unavailable');
  if (read.state === 'unavailable') assert.equal(read.notice.code, 'git-error');
});

test('git resolves from PATH only', async () => {
  assert.ok((await resolveGitBinary())?.path.endsWith('git'));
  assert.equal(await resolveGitBinary({ PATH: '' }), null);
});

test('the child environment is an allowlist, never process.env wholesale', () => {
  const env = baseEnv({ PATH: '/bin', HOME: '/home/u', SECRET: 'nope' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/home/u' });
});
