// The service only ever runs with a project directory the host named, and that
// directory is validated before it becomes a `cwd`.

import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export type DirectoryResult =
  | { ok: true; directory: string }
  | { ok: false; code: 'NO_DIRECTORY' | 'BAD_DIRECTORY'; message: string };

const fail = (code: 'NO_DIRECTORY' | 'BAD_DIRECTORY', message: string): DirectoryResult => ({
  ok: false,
  code,
  message,
});

/** Absolute, existing, a directory, and not a filesystem root. */
export const resolveProjectDirectory = async (input: unknown): Promise<DirectoryResult> => {
  if (typeof input !== 'string' || input.trim() === '') {
    return fail('NO_DIRECTORY', 'No project directory was given');
  }
  const candidate = input.trim();
  if (candidate.includes('\0')) return fail('BAD_DIRECTORY', 'The project directory contains a null byte');
  if (candidate.length > 4096) return fail('BAD_DIRECTORY', 'The project directory is too long');
  if (!path.isAbsolute(candidate)) return fail('BAD_DIRECTORY', 'The project directory must be absolute');

  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    return fail('BAD_DIRECTORY', 'The project directory does not exist');
  }

  try {
    const info = await stat(real);
    if (!info.isDirectory()) return fail('BAD_DIRECTORY', 'The project directory is not a directory');
  } catch {
    return fail('BAD_DIRECTORY', 'The project directory does not exist');
  }

  if (real === path.parse(real).root) {
    return fail('BAD_DIRECTORY', 'Refusing to run git in the filesystem root');
  }

  return { ok: true, directory: real };
};
