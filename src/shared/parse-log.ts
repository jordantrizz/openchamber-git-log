// `git log --decorate=short --format=%h%x00%s%x00%D`: one line per commit,
// three NUL-separated fields. The subject is one line by definition.

import { parseDecorations } from './refs.ts';
import type { LogCommit, LogInfo } from './types.ts';

export const LOG_CAP = 500;

export const parseLog = (raw: string, cap = LOG_CAP): LogInfo => {
  const commits: LogCommit[] = [];

  for (const line of raw.split('\n')) {
    if (line === '') continue;
    const fields = line.split('\0');
    if (fields.length < 2) continue;
    const sha = fields[0] ?? '';
    if (sha === '') continue;
    const decorations = parseDecorations(fields[2] ?? '');
    commits.push({
      sha,
      subject: fields[1] ?? '',
      branches: decorations.branches,
      tags: decorations.tags,
      head: decorations.head,
    });
    if (commits.length > cap) break;
  }

  return {
    commits: commits.slice(0, cap),
    capped: commits.length >= cap,
    empty: commits.length === 0,
  };
};
