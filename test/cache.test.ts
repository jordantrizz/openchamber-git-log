import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SnapshotCache } from '../src/service/cache.ts';

test('a cached read is served until the TTL passes', async () => {
  let now = 0;
  let loads = 0;
  const cache = new SnapshotCache<number>(1000, () => now);
  const load = async (): Promise<number> => {
    loads += 1;
    return loads;
  };

  assert.equal(await cache.get('a', load), 1);
  assert.equal(await cache.get('a', load), 1);
  assert.equal(loads, 1);

  now = 1001;
  assert.equal(await cache.get('a', load), 2);
  assert.equal(loads, 2);
});

test('concurrent callers share one in-flight read', async () => {
  const cache = new SnapshotCache<string>();
  let loads = 0;
  let release: (value: string) => void = () => undefined;
  const load = (): Promise<string> => {
    loads += 1;
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  };

  const first = cache.get('a', load);
  const second = cache.get('a', load);
  assert.equal(first, second);
  release('one');
  assert.equal(await first, 'one');
  assert.equal(loads, 1);
});

test('keys are independent and invalidate drops one or all', async () => {
  let loads = 0;
  const cache = new SnapshotCache<number>(60_000);
  const load = async (): Promise<number> => {
    loads += 1;
    return loads;
  };

  assert.equal(await cache.get('a', load), 1);
  assert.equal(await cache.get('b', load), 2);
  cache.invalidate('a');
  assert.equal(await cache.get('a', load), 3);
  assert.equal(await cache.get('b', load), 2);
  cache.invalidate();
  assert.equal(await cache.get('b', load), 4);
});

test('a failed read is not cached', async () => {
  const cache = new SnapshotCache<number>();
  let attempts = 0;
  const load = async (): Promise<number> => {
    attempts += 1;
    if (attempts === 1) throw new Error('boom');
    return 7;
  };

  await assert.rejects(cache.get('a', load));
  assert.equal(await cache.get('a', load), 7);
  assert.equal(attempts, 2);
});
