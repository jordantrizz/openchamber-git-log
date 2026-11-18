import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseStatus } from '../src/shared/parse-status.ts';
import { fixtureJson } from './helpers.ts';

test('parses the branch header, upstream and every changed path', async () => {
  const { raw = '' } = await fixtureJson('status-v2.json');
  const parsed = parseStatus(raw);

  assert.deepEqual(parsed.head, {
    branch: 'main',
    detached: false,
    oid: 'cf743f04d84e2df9fb6296150f6c6a7e06b04dcd',
    unborn: false,
  });
  assert.deepEqual(parsed.upstream, { name: 'origin/main', ahead: 2, behind: 1 });
  assert.deepEqual(parsed.counts, { staged: 2, modified: 1, untracked: 1, conflicted: 1 });
  assert.deepEqual(
    parsed.files.map((file) => [file.path, file.code, file.group, file.from]),
    [
      ['a.txt', 'MM', 'modified', undefined],
      ['sub/c.txt', 'R.', 'staged', 'sub/b.txt'],
      ['new.txt', '??', 'untracked', undefined],
      ['conflict.txt', 'UU', 'conflicted', undefined],
    ],
  );
  assert.equal(parsed.truncated, false);
});

test('an unborn branch is a state, not an error', async () => {
  const { raw = '' } = await fixtureJson('status-empty.json');
  const parsed = parseStatus(raw);
  assert.equal(parsed.head.branch, 'main');
  assert.equal(parsed.head.unborn, true);
  assert.equal(parsed.head.oid, null);
  assert.equal(parsed.head.detached, false);
  assert.equal(parsed.upstream, null);
});

test('detached HEAD keeps no branch name', () => {
  const parsed = parseStatus('# branch.oid abc1234\0# branch.head (detached)\0');
  assert.equal(parsed.head.branch, null);
  assert.equal(parsed.head.detached, true);
  assert.equal(parsed.head.oid, 'abc1234');
});

test('unknown records and empty NULs are ignored', () => {
  const parsed = parseStatus('\0\0# branch.head main\0! ignored.txt\0x future record\0');
  assert.equal(parsed.files.length, 0);
  assert.deepEqual(parsed.counts, { staged: 0, modified: 0, untracked: 0, conflicted: 0 });
});

test('a path with spaces survives the split', () => {
  const parsed = parseStatus('1 .M N... 100644 100644 100644 a b dir with space/file name.txt\0');
  assert.equal(parsed.files[0]?.path, 'dir with space/file name.txt');
  assert.equal(parsed.counts.modified, 1);
});
