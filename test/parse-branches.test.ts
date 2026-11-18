import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseBranches } from '../src/shared/parse-branches.ts';
import { fixtureJson } from './helpers.ts';

test('splits locals from remotes, newest first, and marks the current branch', async () => {
  const { raw = '' } = await fixtureJson('branches.json');
  const parsed = parseBranches(raw, 'main');

  assert.deepEqual(
    parsed.locals.map((branch) => branch.name),
    ['feature/log', 'main'],
  );
  assert.deepEqual(
    parsed.remotes.map((branch) => branch.name),
    ['origin/main'],
  );

  const main = parsed.locals.find((branch) => branch.name === 'main');
  assert.equal(main?.current, true);
  assert.equal(main?.upstream, 'origin/main');
  assert.equal(main?.ahead, 2);
  assert.equal(main?.behind, 1);
  assert.equal(main?.oid, 'cf743f0');
  assert.equal(main?.relativeDate, '2 days ago');
  assert.equal(main?.subject, 'chore: release v0.6.0');

  const feature = parsed.locals.find((branch) => branch.name === 'feature/log');
  assert.equal(feature?.upstream, null);
  assert.equal(feature?.ahead, 0);
  assert.equal(parsed.truncated, false);
});

test('a symbolic remote HEAD is not listed twice', async () => {
  const { raw = '' } = await fixtureJson('branches.json');
  const parsed = parseBranches(raw, null);
  assert.equal(parsed.remotes.some((branch) => branch.name === 'origin/HEAD'), false);
});

test('the cap drops the oldest rows and reports truncation', async () => {
  const { raw = '' } = await fixtureJson('branches.json');
  const parsed = parseBranches(raw, 'main', 1);
  assert.equal(parsed.locals.length, 1);
  assert.equal(parsed.locals[0]?.name, 'feature/log');
  assert.equal(parsed.truncated, true);
});

test('a malformed line is skipped, not thrown', () => {
  const parsed = parseBranches('refs/heads/main\0main\0abc', 'main');
  assert.equal(parsed.locals.length, 0);
  assert.equal(parsed.truncated, false);
});
