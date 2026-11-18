import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseWorktrees } from '../src/shared/parse-worktrees.ts';
import { fixtureText } from './helpers.ts';

test('parses every worktree block and marks the current checkout', async () => {
  const raw = await fixtureText('worktrees.txt');
  const rows = parseWorktrees(raw, '/home/u/git/demo');

  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    path: '/home/u/git/demo',
    branch: 'main',
    oid: '5c496f2',
    current: true,
    detached: false,
    bare: false,
    locked: null,
    prunable: null,
  });
  assert.equal(rows[1]?.detached, true);
  assert.equal(rows[1]?.branch, null);
  assert.equal(rows[1]?.locked, 'maintenance window');
  assert.equal(rows[2]?.branch, 'old');
  assert.equal(rows[2]?.prunable, 'gitdir file points to non-existent location');
  assert.equal(rows[2]?.current, false);
});

test('a path with spaces is kept whole', () => {
  const raw = 'worktree /home/u/my checkout\nHEAD 1234567890\nbranch refs/heads/main\n';
  const rows = parseWorktrees(raw, '/home/u/my checkout');
  assert.equal(rows[0]?.path, '/home/u/my checkout');
  assert.equal(rows[0]?.current, true);
});

test('no repo root means no row is current', async () => {
  const raw = await fixtureText('worktrees.txt');
  assert.equal(parseWorktrees(raw, null).every((row) => !row.current), true);
});
