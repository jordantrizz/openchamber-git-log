import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RunResult } from '../src/service/exec.ts';
import type { GitKind, GitRunner } from '../src/service/git.ts';
import { buildSnapshot } from '../src/service/snapshot.ts';
import { fixtureJson, fixtureText } from './helpers.ts';

const ok = (stdout: string): RunResult => ({
  ok: true,
  exitCode: 0,
  signal: null,
  stdout,
  stderr: '',
  timedOut: false,
  truncated: false,
  error: null,
});

const bad = (stderr: string, overrides: Partial<RunResult> = {}): RunResult => ({
  ok: false,
  exitCode: 1,
  signal: null,
  stdout: '',
  stderr,
  timedOut: false,
  truncated: false,
  error: null,
  ...overrides,
});

const timedOut = (): RunResult => ({
  ok: false,
  exitCode: null,
  signal: 'SIGKILL',
  stdout: '',
  stderr: '',
  timedOut: true,
  truncated: false,
  error: null,
});

const runner = (answers: Partial<Record<GitKind, RunResult>>): GitRunner => {
  return async (_binary, _argv, _cwd, kind) =>
    answers[kind] ?? (kind === 'root' ? ok('/home/u/git/demo\n') : ok(''));
};

test('composes every section from the five reads', async () => {
  const status = await fixtureJson('status-v2.json');
  const branches = await fixtureJson('branches.json');
  const log = await fixtureJson('log.json');
  const worktrees = await fixtureText('worktrees.txt');

  const snapshot = await buildSnapshot('/home/u/git/demo', {
    binary: { path: '/usr/bin/git', source: 'path' },
    run: runner({
      status: ok(status.raw ?? ''),
      branches: ok(branches.raw ?? ''),
      log: ok(log.raw ?? ''),
      worktrees: ok(worktrees),
    }),
  });

  assert.equal(snapshot.repo?.name, 'demo');
  assert.equal(snapshot.head.branch, 'main');
  assert.equal(snapshot.upstream?.ahead, 2);
  assert.equal(snapshot.status.files.length, 4);
  assert.equal(snapshot.log.commits[0]?.tags[0], 'v0.6.0');
  assert.equal(snapshot.log.commits[0]?.head, true);
  assert.equal(snapshot.branches.locals.length, 2);
  assert.equal(snapshot.branches.remotes.length, 1);
  assert.equal(snapshot.worktrees.length, 3);
  assert.equal(snapshot.worktrees[0]?.current, true);
  assert.deepEqual(snapshot.notices, []);
});

test('a directory outside a repository has no repo and no notice', async () => {
  const snapshot = await buildSnapshot('/tmp', {
    binary: { path: '/usr/bin/git', source: 'path' },
    run: runner({ root: bad('fatal: not a git repository (or any of the parent directories): .git') }),
  });
  assert.equal(snapshot.repo, null);
  assert.equal(snapshot.head.branch, null);
  assert.deepEqual(snapshot.notices, []);
});

test('a missing binary is the one notice and nothing else', async () => {
  const snapshot = await buildSnapshot('/tmp', { binary: null });
  assert.equal(snapshot.repo, null);
  assert.equal(snapshot.notices.length, 1);
  assert.equal(snapshot.notices[0]?.code, 'git-missing');
  assert.equal(snapshot.notices[0]?.tone, 'muted');
});

test('an unborn branch is a state with an empty log, not a notice', async () => {
  const status = await fixtureJson('status-empty.json');
  const snapshot = await buildSnapshot('/home/u/git/demo', {
    binary: { path: '/usr/bin/git', source: 'path' },
    run: runner({
      status: ok(status.raw ?? ''),
      log: bad("fatal: your current branch 'main' does not have any commits yet"),
    }),
  });
  assert.equal(snapshot.head.unborn, true);
  assert.equal(snapshot.head.branch, 'main');
  assert.equal(snapshot.log.empty, true);
  assert.deepEqual(snapshot.notices, []);
});

test('one failed section keeps the others and names itself', async () => {
  const snapshot = await buildSnapshot('/home/u/git/demo', {
    binary: { path: '/usr/bin/git', source: 'path' },
    run: runner({
      status: timedOut(),
      log: ok('abc1234\0subject\0HEAD -> main'),
    }),
  });
  assert.equal(snapshot.repo?.name, 'demo');
  assert.equal(snapshot.log.commits.length, 1);
  assert.equal(snapshot.status.files.length, 0);
  assert.equal(snapshot.notices[0]?.code, 'status-error');
  assert.match(snapshot.notices[0]?.message ?? '', /status did not answer/u);
});

test('a truncated read is a muted notice', async () => {
  const status = await fixtureJson('status-v2.json');
  const snapshot = await buildSnapshot('/home/u/git/demo', {
    binary: { path: '/usr/bin/git', source: 'path' },
    run: runner({ status: { ...ok(status.raw ?? ''), truncated: true } }),
  });
  assert.equal(snapshot.notices[0]?.code, 'status-truncated');
  assert.equal(snapshot.notices[0]?.tone, 'muted');
});

test('a log read that caps is marked, not truncated', async () => {
  const lines = Array.from({ length: 500 }, (_, index) => `sha${index}\0subject ${index}\0`);
  const snapshot = await buildSnapshot('/home/u/git/demo', {
    binary: { path: '/usr/bin/git', source: 'path' },
    run: runner({ log: ok(lines.join('\n')) }),
  });
  assert.equal(snapshot.log.commits.length, 500);
  assert.equal(snapshot.log.capped, true);
});

test('the whole read has its own deadline', async () => {
  const snapshot = await buildSnapshot('/home/u/git/demo', {
    binary: { path: '/usr/bin/git', source: 'path' },
    deadlineMs: 20,
    run: async () => new Promise<RunResult>(() => undefined),
  });
  assert.equal(snapshot.repo, null);
  assert.equal(snapshot.notices[0]?.code, 'snapshot-timeout');
  assert.equal(snapshot.notices[0]?.tone, 'warning');
});
