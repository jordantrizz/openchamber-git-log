import assert from 'node:assert/strict';
import { test } from 'node:test';

import { branchTrack, emptyStateFor, headerLine, logPage, refChips, statusRows, trackLabel } from '../src/panel/view.ts';
import type { GitSnapshot, LogCommit } from '../src/shared/types.ts';
import { sampleSnapshot } from './helpers.ts';

const commit = (overrides: Partial<LogCommit> = {}): LogCommit => ({
  sha: 'a1b2c3d',
  subject: 'feat: add the log',
  branches: ['main', 'origin/main'],
  tags: ['v1.0.0'],
  head: true,
  ...overrides,
});

test('the flat log shows 50 rows and grows in pages', () => {
  const commits = Array.from({ length: 120 }, (_, index) => commit({ sha: `sha${index}` }));

  const first = logPage(commits, 50);
  assert.equal(first.shown.length, 50);
  assert.equal(first.hidden, 70);
  assert.equal(first.canLoadMore, true);
  assert.equal(first.note, '50 of 120');

  const second = logPage(commits, 100);
  assert.equal(second.shown.length, 100);
  assert.equal(second.hidden, 20);

  const all = logPage(commits, 500);
  assert.equal(all.shown.length, 120);
  assert.equal(all.canLoadMore, false);
  assert.equal(all.note, '120 commits');
});

test('a short log never needs a second page and zero still shows 50', () => {
  const short = logPage([commit(), commit(), commit()], 50);
  assert.equal(short.shown.length, 3);
  assert.equal(short.canLoadMore, false);
  assert.equal(short.note, '3 commits');

  const zero = logPage([commit(), commit()], 0);
  assert.equal(zero.shown.length, 2);
});

test('ref chips put HEAD first, then branches, then tags', () => {
  const chips = refChips(commit(), new Set(['origin/main']));
  assert.deepEqual(
    chips.map((entry) => [entry.text, entry.tone]),
    [
      ['HEAD', 'warning'],
      ['main', 'accent'],
      ['origin/main', 'info'],
      ['v1.0.0', 'success'],
    ],
  );
});

test('a commit without decorations has no chips', () => {
  assert.deepEqual(refChips(commit({ head: false, branches: [], tags: [] }), new Set()), []);
});

test('the status list is capped at 100 rows and counts the rest', () => {
  const files = Array.from({ length: 150 }, (_, index) => ({
    path: `file-${index}.txt`,
    code: 'M.',
    group: 'staged' as const,
  }));
  const { rows, hidden } = statusRows(files);
  assert.equal(rows.length, 100);
  assert.equal(hidden, 50);
});

test('the track label is honest about no upstream and matching refs', () => {
  assert.equal(branchTrack(null), null);
  assert.equal(branchTrack({ name: 'origin/main', ahead: 0, behind: 0 }), 'up to date');
  assert.equal(branchTrack({ name: 'origin/main', ahead: 2, behind: 1 }), '+2/-1');
  assert.equal(trackLabel(0, 0), 'up to date');
  assert.equal(trackLabel(2, 1), '+2/-1');
});

test('a missing git is not shown as a non-checkout', () => {
  const notRepo = emptyStateFor(sampleSnapshot({ repo: null }));
  assert.equal(notRepo.title, 'This project is not a git checkout');

  const missing = emptyStateFor(
    sampleSnapshot({
      repo: null,
      notices: [{ code: 'git-missing', tone: 'muted', message: 'git was not found' }],
    }),
  );
  assert.equal(missing.title, 'Git is unavailable');
  assert.equal(missing.body, 'git was not found');
});

test('the header names the branch, the detached HEAD and the missing repo', () => {
  const base: GitSnapshot = sampleSnapshot();

  assert.deepEqual(headerLine(base), {
    title: 'demo',
    sub: 'main → origin/main · +1/-0',
  });
  assert.deepEqual(headerLine(sampleSnapshot({ upstream: null })), {
    title: 'demo',
    sub: 'main · no upstream',
  });
  assert.deepEqual(
    headerLine(sampleSnapshot({ head: { branch: null, detached: true, oid: 'abc1234', unborn: false } })),
    { title: 'demo', sub: 'detached at abc1234' },
  );
  assert.deepEqual(
    headerLine(sampleSnapshot({ head: { branch: 'main', detached: false, oid: null, unborn: true } })),
    { title: 'demo', sub: 'main · no commits yet' },
  );
  assert.deepEqual(headerLine(sampleSnapshot({ repo: null })), {
    title: 'No repository',
    sub: 'This project is not a git checkout',
  });
});
