// One snapshot per project directory: repo identity, HEAD, status, the flat
// commit list, every branch and every worktree. A broken section becomes a
// notice; it never hides the sections that answered.

import path from 'node:path';

import { parseBranches } from '../shared/parse-branches.ts';
import { parseLog } from '../shared/parse-log.ts';
import { parseStatus } from '../shared/parse-status.ts';
import { parseWorktrees } from '../shared/parse-worktrees.ts';
import { firstLine } from '../shared/text.ts';
import {
  emptyBranches,
  emptyHead,
  emptyLog,
  emptyStatus,
} from '../shared/types.ts';
import type { GitSnapshot, Notice } from '../shared/types.ts';
import type { RunResult } from './exec.ts';
import { readGit } from './git.ts';
import type { GitRead, ReadGitOptions } from './git.ts';

export const SNAPSHOT_DEADLINE_MS = 6000;

const NO_COMMITS = /does not have any commits yet|bad default revision|ambiguous argument 'HEAD'|unknown revision/iu;

const truncatedNotice = (section: string): Notice => ({
  code: `${section}-truncated`,
  tone: 'muted',
  message: `The ${section} read was truncated`,
  detail: 'Only the first part of the git output was used.',
});

const failedNotice = (section: string, detail?: string): Notice => ({
  code: `${section}-error`,
  tone: 'warning',
  message: `git ${section} did not answer`,
  ...(detail === undefined ? {} : { detail }),
});

/** A timed-out read, a failed read or a capped read, as one notice. */
const sectionNotice = (
  section: string,
  result: RunResult,
  extraTruncated = false,
): Notice | null => {
  if (result.timedOut) return failedNotice(section, 'The read took too long.');
  if (!result.ok) return failedNotice(section, firstLine(result.stderr));
  if (result.truncated || extraTruncated) return truncatedNotice(section);
  return null;
};

const emptySnapshot = (generatedAt: string, notices: Notice[]): GitSnapshot => ({
  generatedAt,
  repo: null,
  head: emptyHead(),
  upstream: null,
  status: emptyStatus(),
  log: emptyLog(),
  branches: emptyBranches(),
  worktrees: [],
  notices,
});

const readWithDeadline = async (
  directory: string,
  options: ReadGitOptions,
  deadlineMs: number,
): Promise<GitRead | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
  });
  try {
    return await Promise.race([readGit(directory, options), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export interface SnapshotOptions extends ReadGitOptions {
  /** The whole read's deadline; tests shorten it. */
  deadlineMs?: number;
}

export const buildSnapshot = async (
  directory: string,
  options: SnapshotOptions = {},
): Promise<GitSnapshot> => {
  const generatedAt = new Date().toISOString();
  const deadlineMs = options.deadlineMs ?? SNAPSHOT_DEADLINE_MS;
  const read = await readWithDeadline(directory, options, deadlineMs);

  if (read === null) {
    return emptySnapshot(generatedAt, [
      {
        code: 'snapshot-timeout',
        tone: 'warning',
        message: `git did not answer within ${Math.round(deadlineMs / 1000)} s`,
        detail: 'The checkout may be large or on a slow disk. Refresh to try again.',
      },
    ]);
  }

  if (read.state === 'not-repo') return emptySnapshot(generatedAt, []);
  if (read.state === 'unavailable') return emptySnapshot(generatedAt, [read.notice]);

  const answers = read.answers;
  const notices: Notice[] = [];
  const root = answers.root.stdout.trim();
  const repo = { root, name: path.basename(root) };

  const status = answers.status.ok ? parseStatus(answers.status.stdout) : parseStatus('');
  const statusNotice = sectionNotice('status', answers.status, status.truncated);
  if (statusNotice) notices.push(statusNotice);

  const branches = answers.branches.ok
    ? parseBranches(answers.branches.stdout, status.head.branch)
    : emptyBranches();
  const branchesNotice = sectionNotice('branches', answers.branches, branches.truncated);
  if (branchesNotice) notices.push(branchesNotice);

  const worktrees = answers.worktrees.ok ? parseWorktrees(answers.worktrees.stdout, root) : [];
  const worktreesNotice = sectionNotice('worktrees', answers.worktrees);
  if (worktreesNotice) notices.push(worktreesNotice);

  let log = emptyLog();
  if (answers.log.timedOut) {
    notices.push(failedNotice('log', 'The read took too long.'));
  } else if (answers.log.ok) {
    log = parseLog(answers.log.stdout);
    if (answers.log.truncated) notices.push(truncatedNotice('log'));
  } else if (!NO_COMMITS.test(answers.log.stderr)) {
    notices.push(failedNotice('log', firstLine(answers.log.stderr)));
  }

  return {
    generatedAt,
    repo,
    head: status.head,
    upstream: status.upstream,
    status: { counts: status.counts, files: status.files, truncated: status.truncated },
    log,
    branches,
    worktrees,
    notices,
  };
};
