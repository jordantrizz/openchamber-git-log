// The one read-only git boundary. Every argument vector is fixed here, no
// request field reaches argv, and every call carries `--no-optional-locks` so a
// read never takes the index lock.

import path from 'node:path';

import { LOG_CAP } from '../shared/parse-log.ts';
import { firstLine } from '../shared/text.ts';
import type { Notice } from '../shared/types.ts';
import {
  DEFAULT_DEADLINE_MS,
  STDERR_LIMIT_BYTES,
  STDOUT_LIMIT_BYTES,
  baseEnv,
  refuse,
  runCommand,
  searchPath,
} from './exec.ts';
import type { RunResult } from './exec.ts';

export const GIT_LOG_LIMIT_BYTES = 512 * 1024;

const ROOT_VECTOR = ['--no-optional-locks', 'rev-parse', '--show-toplevel'] as const;
const STATUS_VECTOR = ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z'] as const;
const BRANCH_VECTOR = [
  '--no-optional-locks',
  'for-each-ref',
  '--format=%(refname)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(committerdate:relative)%00%(committerdate:unix)%00%(subject)',
  'refs/heads',
  'refs/remotes',
] as const;
const WORKTREE_VECTOR = ['--no-optional-locks', 'worktree', 'list', '--porcelain'] as const;
const LOG_VECTOR = [
  '--no-optional-locks',
  'log',
  '--no-color',
  '--no-show-signature',
  '--decorate=short',
  '--format=%h%x00%s%x00%D',
  `--max-count=${LOG_CAP}`,
] as const;

export type GitKind = 'root' | 'status' | 'branches' | 'worktrees' | 'log';

const GIT_ARGV: Record<GitKind, readonly string[]> = {
  root: ROOT_VECTOR,
  status: STATUS_VECTOR,
  branches: BRANCH_VECTOR,
  worktrees: WORKTREE_VECTOR,
  log: LOG_VECTOR,
};

/** Every argv the service may run for git, in call order. */
export const GIT_VECTORS: readonly (readonly string[])[] = [
  ROOT_VECTOR,
  STATUS_VECTOR,
  BRANCH_VECTOR,
  WORKTREE_VECTOR,
  LOG_VECTOR,
];

export const isAllowedGitVector = (args: readonly string[]): boolean =>
  GIT_VECTORS.some(
    (allowed) => allowed.length === args.length && allowed.every((step, index) => step === args[index]),
  );

/** The argv for a kind. There is no parameter that can carry a value. */
export const buildGitArgs = (kind: GitKind): readonly string[] => [...GIT_ARGV[kind]];

const gitEnv = (): NodeJS.ProcessEnv => {
  const env = baseEnv();
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_PAGER = 'cat';
  return env;
};

export interface ResolvedGitBinary {
  path: string;
  source: 'path';
}

/**
 * `git` on PATH, and nothing else: no `GIT_BIN` override, because that would
 * be a user-controlled executable path.
 */
export const resolveGitBinary = async (
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedGitBinary | null> => {
  const searchDirs = (env.PATH ?? '').split(path.delimiter).filter((dir) => dir !== '');
  const found = await searchPath('git', searchDirs);
  return found === null ? null : { path: found, source: 'path' };
};

export type GitRunner = (
  binary: string,
  argv: readonly string[],
  cwd: string,
  kind: GitKind,
) => Promise<RunResult>;

const defaultRunner: GitRunner = (binary, argv, cwd, kind) => {
  // Defence in depth: the table above is the only source, and this refuses
  // anything that did not come from it before a child is spawned.
  if (!isAllowedGitVector(argv)) return Promise.resolve(refuse('git vector is not on the allowlist'));
  return runCommand(binary, argv, cwd, {
    deadlineMs: DEFAULT_DEADLINE_MS,
    stdoutLimit: kind === 'log' ? GIT_LOG_LIMIT_BYTES : STDOUT_LIMIT_BYTES,
    stderrLimit: STDERR_LIMIT_BYTES,
    env: gitEnv(),
  });
};

export interface GitAnswers {
  root: RunResult;
  status: RunResult;
  branches: RunResult;
  worktrees: RunResult;
  log: RunResult;
}

export type GitRead =
  | { state: 'ok'; answers: GitAnswers }
  | { state: 'not-repo' }
  | { state: 'unavailable'; notice: Notice };

const NOT_A_REPOSITORY = /not a git repository/iu;
const NOT_A_WORK_TREE = /must be run in a work tree/iu;

export interface ReadGitOptions {
  /** Resolve once per service; `null` disables the read. */
  binary?: ResolvedGitBinary | null;
  run?: GitRunner;
}

/**
 * Read the checkout in one concurrent pass. A directory that is not a
 * repository is an ordinary state; a missing binary or a root failure is one
 * notice and no answers.
 */
export const readGit = async (
  directory: string,
  options: ReadGitOptions = {},
): Promise<GitRead> => {
  const binary = options.binary === undefined ? await resolveGitBinary() : options.binary;
  if (binary === null) {
    return {
      state: 'unavailable',
      notice: {
        code: 'git-missing',
        tone: 'muted',
        message: 'git was not found',
        detail: 'The panel needs git on PATH.',
      },
    };
  }

  const run = options.run ?? defaultRunner;
  const [root, status, branches, worktrees, log] = await Promise.all([
    run(binary.path, buildGitArgs('root'), directory, 'root'),
    run(binary.path, buildGitArgs('status'), directory, 'status'),
    run(binary.path, buildGitArgs('branches'), directory, 'branches'),
    run(binary.path, buildGitArgs('worktrees'), directory, 'worktrees'),
    run(binary.path, buildGitArgs('log'), directory, 'log'),
  ]);

  if (root.error !== null) {
    return {
      state: 'unavailable',
      notice: {
        code: 'git-error',
        tone: 'warning',
        message: 'git could not start',
        detail: root.error,
      },
    };
  }

  if (root.timedOut) {
    return {
      state: 'unavailable',
      notice: {
        code: 'git-timeout',
        tone: 'warning',
        message: `git did not answer within ${Math.round(DEFAULT_DEADLINE_MS / 1000)} s`,
        detail: 'The checkout may be large or on a slow disk.',
      },
    };
  }

  if (!root.ok) {
    if (NOT_A_REPOSITORY.test(root.stderr) || NOT_A_WORK_TREE.test(root.stderr)) {
      return { state: 'not-repo' };
    }
    const line = firstLine(root.stderr);
    return {
      state: 'unavailable',
      notice: {
        code: 'git-error',
        tone: 'warning',
        message: 'git could not describe this checkout',
        ...(line === undefined ? {} : { detail: line }),
      },
    };
  }

  return { state: 'ok', answers: { root, status, branches, worktrees, log } };
};
