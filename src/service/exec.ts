// The one place a child process starts. Each caller owns a fixed allowlist;
// this module only spawns, caps and kills. No shell, no string interpolation.

import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';

export const STDOUT_LIMIT_BYTES = 256 * 1024;
export const STDERR_LIMIT_BYTES = 16 * 1024;
export const DEFAULT_DEADLINE_MS = 4000;

/** The variables a CLI needs: a path, a home, a locale and a temp directory. */
const INHERITED_ENV = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP', 'USER'] as const;

export interface RunResult {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  /** A spawn-level failure, such as a missing binary. */
  error: string | null;
}

export interface RunOptions {
  deadlineMs?: number;
  stdoutLimit?: number;
  stderrLimit?: number;
  /** The complete child environment. Never a blanket `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** The inherited environment an allowlist starts from. */
export const baseEnv = (source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENV) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
};

/** A result for a call that never started, such as a refused vector. */
export const refuse = (error: string): RunResult => ({
  ok: false,
  exitCode: null,
  signal: null,
  stdout: '',
  stderr: '',
  timedOut: false,
  truncated: false,
  error,
});

/** Run one fixed argv in `cwd`. Oversized output is capped and reported, never thrown. */
export const runCommand = (
  binary: string,
  argv: readonly string[],
  cwd: string,
  options: RunOptions = {},
): Promise<RunResult> => {
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const stdoutLimit = options.stdoutLimit ?? STDOUT_LIMIT_BYTES;
  const stderrLimit = options.stderrLimit ?? STDERR_LIMIT_BYTES;
  const env = options.env ?? baseEnv();

  return new Promise<RunResult>((resolve) => {
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;
    let spawnError: string | null = null;
    let settled = false;

    const child = spawn(binary, [...argv], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, deadlineMs);
    timer.unref?.();

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= stdoutLimit) {
        truncated = true;
        return;
      }
      const room = stdoutLimit - stdoutBytes;
      if (chunk.byteLength > room) {
        chunks.push(chunk.subarray(0, room));
        stdoutBytes = stdoutLimit;
        truncated = true;
        return;
      }
      chunks.push(chunk);
      stdoutBytes += chunk.byteLength;
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= stderrLimit) {
        truncated = true;
        return;
      }
      const room = stderrLimit - stderrBytes;
      if (chunk.byteLength > room) {
        errorChunks.push(chunk.subarray(0, room));
        stderrBytes = stderrLimit;
        truncated = true;
        return;
      }
      errorChunks.push(chunk);
      stderrBytes += chunk.byteLength;
    });

    child.on('error', (error) => {
      spawnError = error.message;
    });

    const finish = (exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: spawnError === null && !timedOut && exitCode === 0,
        exitCode,
        signal,
        stdout: Buffer.concat(chunks).toString('utf8'),
        stderr: Buffer.concat(errorChunks).toString('utf8'),
        timedOut,
        truncated,
        error: spawnError,
      });
    };

    child.on('close', finish);
  });
};

/** A binary is usable when it is an executable regular file. */
export const isExecutableFile = async (candidate: string): Promise<boolean> => {
  try {
    const info = await stat(candidate);
    if (!info.isFile()) return false;
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** The first executable named `name` on the given search directories. */
export const searchPath = async (
  name: string,
  searchDirs: readonly string[],
): Promise<string | null> => {
  for (const dir of searchDirs) {
    const candidate = path.join(dir, name);
    if (await isExecutableFile(candidate)) return candidate;
  }
  return null;
};
