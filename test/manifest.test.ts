import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('package is a zero-capability, panel-only extension', () => {
  assert.equal(pkg.name, 'openchamber-git-log');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.openchamber.apiVersion, 1);
  assert.equal(pkg.openchamber.contributes.panel.id, 'git-log');
  assert.equal(pkg.openchamber.contributes.panel.name, 'Git');
  assert.equal(pkg.openchamber.contributes.service.runtime, 'host');
  assert.deepEqual(pkg.openchamber.contributes.service.permissions.exec, ['git']);
  assert.equal(pkg.openchamber.contributes.page, undefined);
  assert.equal(pkg.openchamber.contributes.statusSection, undefined);
  assert.equal(pkg.openchamber.contributes.background, undefined);
  assert.equal(pkg.openchamber.contributes.capabilities, undefined);
});
