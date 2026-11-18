// `git for-each-ref` with NUL-separated atoms:
// refname, short, objectname:short, upstream:short, upstream:track,
// committerdate:relative, committerdate:unix, subject.

import type { BranchRow, BranchesInfo } from './types.ts';

export const BRANCH_CAP = 200;

const FIELD_COUNT = 8;

const numbers = (track: string): { ahead: number; behind: number } => {
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return {
    ahead: ahead ? Number.parseInt(ahead[1] ?? '0', 10) : 0,
    behind: behind ? Number.parseInt(behind[1] ?? '0', 10) : 0,
  };
};

export const parseBranches = (
  raw: string,
  currentBranch: string | null,
  cap = BRANCH_CAP,
): BranchesInfo => {
  const locals: BranchRow[] = [];
  const remotes: BranchRow[] = [];
  const sortKey = new Map<BranchRow, number>();
  let dropped = false;

  for (const line of raw.split('\n')) {
    if (line === '') continue;
    const fields = line.split('\0');
    if (fields.length < FIELD_COUNT) continue;

    const refname = fields[0] ?? '';
    const name = fields[1] ?? '';
    if (name === '') continue;

    // A symbolic remote HEAD points at a branch that is already listed.
    if (refname.startsWith('refs/remotes/') && name.endsWith('/HEAD')) continue;

    const track = fields[4] ?? '';
    const counts = numbers(track);
    const row: BranchRow = {
      name,
      oid: fields[2] ?? '',
      upstream: (fields[3] ?? '') === '' ? null : (fields[3] ?? null),
      ahead: counts.ahead,
      behind: counts.behind,
      relativeDate: fields[5] ?? '',
      subject: fields[7] ?? '',
      current: name === currentBranch,
    };
    const unix = Number.parseInt(fields[6] ?? '0', 10);
    sortKey.set(row, Number.isNaN(unix) ? 0 : unix);

    if (refname.startsWith('refs/remotes/')) remotes.push(row);
    else if (refname.startsWith('refs/heads/')) locals.push(row);
  }

  const byNewest = (left: BranchRow, right: BranchRow): number =>
    (sortKey.get(right) ?? 0) - (sortKey.get(left) ?? 0);
  locals.sort(byNewest);
  remotes.sort(byNewest);

  const trim = (rows: BranchRow[]): BranchRow[] => {
    if (rows.length <= cap) return rows;
    dropped = true;
    return rows.slice(0, cap);
  };

  return { locals: trim(locals), remotes: trim(remotes), truncated: dropped };
};
