// `git worktree list --porcelain`: one block per worktree, blocks separated by
// a blank line. A path may contain spaces; each value runs to the line end.
// The stdout cap bounds a pathological answer; every worktree is listed.

import path from 'node:path';

import type { WorktreeRow } from './types.ts';

const valueAfter = (line: string, key: string): string => line.slice(key.length).trim();

export const parseWorktrees = (raw: string, repoRoot: string | null): WorktreeRow[] => {
  const rows: WorktreeRow[] = [];
  const root = repoRoot === null ? null : path.resolve(repoRoot);

  for (const block of raw.split(/\n\s*\n/u)) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;

    let worktreePath: string | null = null;
    let oid: string | null = null;
    let branch: string | null = null;
    let detached = false;
    let bare = false;
    let locked: string | null = null;
    let prunable: string | null = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        worktreePath = valueAfter(line, 'worktree');
      } else if (line.startsWith('HEAD ')) {
        oid = valueAfter(line, 'HEAD').slice(0, 7);
      } else if (line.startsWith('branch ')) {
        const ref = valueAfter(line, 'branch');
        branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
      } else if (line === 'detached') {
        detached = true;
      } else if (line === 'bare') {
        bare = true;
      } else if (line.startsWith('locked')) {
        locked = valueAfter(line, 'locked') === '' ? 'locked' : valueAfter(line, 'locked');
      } else if (line.startsWith('prunable')) {
        prunable = valueAfter(line, 'prunable') === '' ? 'prunable' : valueAfter(line, 'prunable');
      }
    }

    if (worktreePath === null) continue;
    rows.push({
      path: worktreePath,
      branch: detached ? null : branch,
      oid,
      current: root !== null && path.resolve(worktreePath) === root,
      detached,
      bare,
      locked,
      prunable,
    });
  }

  return rows;
};
