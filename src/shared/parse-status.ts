// `git status --porcelain=v2 --branch -z`. Records are NUL-separated; a
// rename or copy is followed by a second record holding its original path.

import type { FileGroup, HeadInfo, StatusCounts, StatusFile, UpstreamInfo } from './types.ts';

export const STATUS_PATH_CAP = 1000;

export interface ParsedStatus {
  head: HeadInfo;
  upstream: UpstreamInfo | null;
  counts: StatusCounts;
  files: StatusFile[];
  truncated: boolean;
}

const emptyCounts = (): StatusCounts => ({ staged: 0, modified: 0, untracked: 0, conflicted: 0 });

const pathFrom = (fields: string[], index: number): string => fields.slice(index).join(' ');

/** Parse one porcelain v2 record set. Unknown lines are ignored, never thrown. */
export const parseStatus = (raw: string, cap = STATUS_PATH_CAP): ParsedStatus => {
  const records = raw.split('\0');
  const counts = emptyCounts();
  const files: StatusFile[] = [];

  let oid: string | null = null;
  let branch: string | null = null;
  let detached = false;
  let unborn = false;
  let upstreamName: string | null = null;
  let ahead = 0;
  let behind = 0;
  let dropped = false;

  const push = (file: StatusFile): void => {
    if (files.length < cap) files.push(file);
    else dropped = true;
  };

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? '';
    if (record === '') continue;

    if (record.startsWith('# ')) {
      const [key, ...rest] = record.slice(2).split(' ');
      const value = rest.join(' ').trim();
      if (key === 'branch.oid') {
        if (value === '(initial)') unborn = true;
        else oid = value === '' ? null : value;
      } else if (key === 'branch.head') {
        if (value === '(detached)') detached = true;
        else branch = value === '' ? null : value;
      } else if (key === 'branch.upstream') {
        upstreamName = value === '' ? null : value;
      } else if (key === 'branch.ab') {
        const aheadMatch = /\+\d+/.exec(value);
        const behindMatch = /-\d+/.exec(value);
        ahead = aheadMatch ? Number.parseInt(aheadMatch[0].slice(1), 10) : 0;
        behind = behindMatch ? Number.parseInt(behindMatch[0].slice(1), 10) : 0;
      }
      continue;
    }

    const kind = record[0];

    if (kind === '1' || kind === '2') {
      const fields = record.split(' ');
      const xy = fields[1] ?? '..';
      const stagedChange = (xy[0] ?? '.') !== '.';
      const worktreeChange = (xy[1] ?? '.') !== '.';
      if (stagedChange) counts.staged += 1;
      if (worktreeChange) counts.modified += 1;
      const path = pathFrom(fields, kind === '2' ? 9 : 8);
      const group: FileGroup = worktreeChange ? 'modified' : 'staged';
      if (kind === '2') {
        const from = records[index + 1] ?? '';
        index += 1;
        push({ path, from, code: xy, group });
      } else {
        push({ path, code: xy, group });
      }
      continue;
    }

    if (kind === 'u') {
      const fields = record.split(' ');
      counts.conflicted += 1;
      push({ path: pathFrom(fields, 10), code: fields[1] ?? 'UU', group: 'conflicted' });
      continue;
    }

    if (kind === '?') {
      counts.untracked += 1;
      push({ path: record.slice(2), code: '??', group: 'untracked' });
      continue;
    }

    // `!` ignored entries and anything git adds later are not shown.
  }

  return {
    head: {
      branch: detached || unborn ? (unborn ? branch : null) : branch,
      detached,
      oid,
      unborn,
    },
    upstream: upstreamName === null ? null : { name: upstreamName, ahead, behind },
    counts,
    files,
    truncated: dropped,
  };
};
