import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, test } from 'node:test';

import { createService } from '../src/service/http.ts';
import type { ServiceHandlers } from '../src/service/http.ts';
import { sampleSnapshot } from './helpers.ts';

const directory = process.cwd();
const invalidated: string[] = [];
const server: Server = createService({
  token: 'secret',
  handlers: {
    snapshot: async () => sampleSnapshot(),
    invalidate: (target) => invalidated.push(target),
  } satisfies ServiceHandlers,
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;
const auth = { authorization: 'Bearer secret' };

after(() => {
  server.closeAllConnections();
  server.close();
});

test('every request needs the bearer token', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 401);
  assert.equal((await fetch(`${base}/health`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(`${base}/health`, { headers: auth })).status, 200);
});

test('health reports the version', async () => {
  const response = await fetch(`${base}/health`, { headers: auth });
  assert.deepEqual(await response.json(), { ok: true, version: '0.1.0' });
});

test('a snapshot needs a real absolute project directory', async () => {
  const missing = await fetch(`${base}/snapshot`, { headers: auth });
  assert.equal(missing.status, 400);
  assert.equal(((await missing.json()) as { code: string }).code, 'NO_DIRECTORY');

  const absent = await fetch(`${base}/snapshot?directory=${encodeURIComponent('/nope/nope')}`, { headers: auth });
  assert.equal(absent.status, 400);
  assert.equal(((await absent.json()) as { code: string }).code, 'BAD_DIRECTORY');

  const relative = await fetch(`${base}/snapshot?directory=nope`, { headers: auth });
  assert.equal(relative.status, 400);
});

test('a snapshot answers the contract', async () => {
  const response = await fetch(`${base}/snapshot?directory=${encodeURIComponent(directory)}`, { headers: auth });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = (await response.json()) as { repo: { name: string }; head: { branch: string } };
  assert.equal(body.repo.name, 'demo');
  assert.equal(body.head.branch, 'main');
});

test('refresh invalidates the directory and answers a fresh snapshot', async () => {
  invalidated.length = 0;
  const response = await fetch(`${base}/refresh`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ directory }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(invalidated, [directory]);
  const body = (await response.json()) as { generatedAt: string };
  assert.equal(body.generatedAt, '2026-11-18T12:00:00.000Z');

  invalidated.length = 0;
  const viaQuery = await fetch(`${base}/refresh?directory=${encodeURIComponent(directory)}`, {
    method: 'POST',
    headers: auth,
  });
  assert.equal(viaQuery.status, 200);
  assert.deepEqual(invalidated, [directory]);
});

test('wrong methods, unknown paths and bad bodies are named errors', async () => {
  const getRefresh = await fetch(`${base}/refresh?directory=${encodeURIComponent(directory)}`, { headers: auth });
  assert.equal(getRefresh.status, 405);

  const postSnapshot = await fetch(`${base}/snapshot?directory=${encodeURIComponent(directory)}`, {
    method: 'POST',
    headers: auth,
  });
  assert.equal(postSnapshot.status, 405);

  const unknown = await fetch(`${base}/other`, { headers: auth });
  assert.equal(unknown.status, 404);

  const badBody = await fetch(`${base}/refresh`, {
    method: 'POST',
    headers: auth,
    body: '{not json',
  });
  assert.equal(badBody.status, 400);
  assert.equal(((await badBody.json()) as { code: string }).code, 'BAD_BODY');
});

test('a handler failure is a named 500 and health reports the build version', async () => {
  const failing = createService({
    token: 'secret',
    version: '9.9.9',
    handlers: {
      snapshot: async () => {
        throw new Error('boom');
      },
      invalidate: () => undefined,
    },
  });
  await new Promise<void>((resolve) => failing.listen(0, '127.0.0.1', resolve));
  const failingPort = (failing.address() as AddressInfo).port;
  const failingBase = `http://127.0.0.1:${failingPort}`;
  try {
    const health = await fetch(`${failingBase}/health`, { headers: auth });
    assert.deepEqual(await health.json(), { ok: true, version: '9.9.9' });

    const response = await fetch(`${failingBase}/snapshot?directory=${encodeURIComponent(directory)}`, {
      headers: auth,
    });
    assert.equal(response.status, 500);
    assert.equal(((await response.json()) as { code: string }).code, 'SNAPSHOT_FAILED');
  } finally {
    failing.closeAllConnections();
    failing.close();
  }
});

test('an oversized body is refused', async () => {
  const body = JSON.stringify({ directory, padding: 'x'.repeat(70 * 1024) });
  try {
    const response = await fetch(`${base}/refresh`, { method: 'POST', headers: auth, body });
    assert.equal(response.status, 400);
  } catch (error) {
    assert.match(String(error), /fetch failed|socket|other side closed/iu);
  }
});
