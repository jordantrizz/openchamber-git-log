import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseLog } from '../src/shared/parse-log.ts';
import { parseDecorations } from '../src/shared/refs.ts';
import { fixtureJson } from './helpers.ts';

test('parses commits and sorts their refs into branches and tags', async () => {
  const { raw = '' } = await fixtureJson('log.json');
  const parsed = parseLog(raw);

  assert.equal(parsed.empty, false);
  assert.equal(parsed.capped, false);
  assert.deepEqual(parsed.commits[0], {
    sha: '5c496f2',
    subject: 'chore: release v0.6.0',
    branches: ['main', 'origin/main'],
    tags: ['v0.6.0'],
    head: true,
  });
  assert.deepEqual(parsed.commits[1]?.tags, ['v0.5.0']);
  assert.deepEqual(parsed.commits[2]?.branches, ['feature/log']);
});

test('an empty log is a state, not a failure', () => {
  const parsed = parseLog('');
  assert.equal(parsed.empty, true);
  assert.equal(parsed.capped, false);
  assert.deepEqual(parsed.commits, []);
});

test('a cap fills and reports itself', () => {
  const line = (n: number): string => `sha${n}\0subject ${n}\0tag: v${n}`;
  const parsed = parseLog([line(1), line(2), line(3)].join('\n'), 2);
  assert.equal(parsed.commits.length, 2);
  assert.equal(parsed.capped, true);
});

test('decorations classify HEAD, branches and tags', () => {
  assert.deepEqual(parseDecorations('HEAD -> main, tag: v1.0.0, origin/main'), {
    branches: ['main', 'origin/main'],
    tags: ['v1.0.0'],
    head: true,
  });
  assert.deepEqual(parseDecorations('HEAD'), { branches: [], tags: [], head: true });
  assert.deepEqual(parseDecorations('tag: v2'), { branches: [], tags: ['v2'], head: false });
  assert.deepEqual(parseDecorations(''), { branches: [], tags: [], head: false });
});
