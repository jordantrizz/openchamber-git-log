import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** A scratch directory the test removes itself (never a real project). */
export const makeTempDir = async (prefix = 'git-log-test-'): Promise<string> =>
  mkdtemp(path.join(os.tmpdir(), prefix));

/** Write an executable POSIX shell script, used as a stand-in for git. */
export const writeScript = async (file: string, body: string): Promise<string> => {
  await writeFile(file, `#!/bin/sh\n${body}\n`, 'utf8');
  await chmod(file, 0o755);
  return file;
};

export const fixtureJson = async (name: string): Promise<Record<string, string>> => {
  const text = await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  return JSON.parse(text) as Record<string, string>;
};

export const fixtureText = async (name: string): Promise<string> =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** A complete healthy snapshot, for transport and service tests. */
export const sampleSnapshot = (
  overrides: Partial<import('../src/shared/types.ts').GitSnapshot> = {},
): import('../src/shared/types.ts').GitSnapshot => ({
  generatedAt: '2026-11-18T12:00:00.000Z',
  repo: { root: '/home/u/git/demo', name: 'demo' },
  head: { branch: 'main', detached: false, oid: '5c496f2', unborn: false },
  upstream: { name: 'origin/main', ahead: 1, behind: 0 },
  status: {
    counts: { staged: 1, modified: 1, untracked: 0, conflicted: 0 },
    files: [{ path: 'a.txt', code: 'MM', group: 'modified' }],
    truncated: false,
  },
  log: { commits: [], capped: false, empty: false },
  branches: { locals: [], remotes: [], truncated: false },
  worktrees: [],
  notices: [],
  ...overrides,
});


export const git = async (cwd: string, args: readonly string[]): Promise<string> => {
  const result = await exec('git', [...args], { cwd, encoding: 'utf8' });
  return result.stdout;
};

/** A real repository with one commit, detached from the user's config. */
export const initRepo = async (): Promise<string> => {
  const directory = await makeTempDir();
  await git(directory, ['init', '-q', '-b', 'main']);
  await git(directory, ['config', 'user.email', 'test@example.com']);
  await git(directory, ['config', 'user.name', 'Test']);
  await writeFile(path.join(directory, 'tracked.txt'), 'one\n', 'utf8');
  await git(directory, ['add', 'tracked.txt']);
  await git(directory, ['commit', '-q', '-m', 'init']);
  return directory;
};
