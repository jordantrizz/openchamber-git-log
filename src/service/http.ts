// The service listens on loopback only, behind the host's bearer token. Every
// request is authenticated; the body is capped; the answer is JSON.

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type { GitSnapshot } from '../shared/types.ts';
import { resolveProjectDirectory } from './directory.ts';

export const BODY_LIMIT_BYTES = 64 * 1024;
export const HEALTH_PATH = '/health';
export const SNAPSHOT_PATH = '/snapshot';
export const REFRESH_PATH = '/refresh';

export interface ServiceHandlers {
  snapshot: (directory: string) => Promise<GitSnapshot>;
  invalidate: (directory: string) => void;
}

export interface ServiceOptions {
  token: string;
  handlers: ServiceHandlers;
  version?: string;
}

interface Reply {
  ok: boolean;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

const send = (response: ServerResponse, status: number, body: object): void => {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
};

const fail = (response: ServerResponse, status: number, code: string, message: string): void => {
  send(response, status, { ok: false, code, message } satisfies Reply);
};

const readJsonBody = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > BODY_LIMIT_BYTES) {
        reject(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text === '') {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(text) as unknown);
      } catch {
        reject(new Error('body is not JSON'));
      }
    });
    request.on('error', reject);
  });

const bearerMatches = (header: string | undefined, token: string): boolean => {
  if (typeof header !== 'string') return false;
  const expected = `Bearer ${token}`;
  if (header.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < header.length; index += 1) {
    mismatch |= header.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
};

const directoryFrom = (value: unknown): unknown =>
  typeof value === 'object' && value !== null && 'directory' in value
    ? (value as { directory?: unknown }).directory
    : undefined;

export const createService = (options: ServiceOptions): Server => {
  const { token, handlers, version = '0.1.0' } = options;

  return createServer((request, response) => {
    void (async () => {
      if (!bearerMatches(request.headers.authorization, token)) {
        fail(response, 401, 'UNAUTHORIZED', 'Missing or wrong bearer token');
        return;
      }

      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname;

      if (path === HEALTH_PATH) {
        if (request.method !== 'GET') {
          fail(response, 405, 'METHOD_NOT_ALLOWED', 'Use GET');
          return;
        }
        send(response, 200, { ok: true, version });
        return;
      }

      if (path !== SNAPSHOT_PATH && path !== REFRESH_PATH) {
        fail(response, 404, 'NOT_FOUND', 'Unknown path');
        return;
      }

      if (path === SNAPSHOT_PATH && request.method !== 'GET') {
        fail(response, 405, 'METHOD_NOT_ALLOWED', 'Use GET');
        return;
      }
      if (path === REFRESH_PATH && request.method !== 'POST') {
        fail(response, 405, 'METHOD_NOT_ALLOWED', 'Use POST');
        return;
      }

      let rawDirectory: unknown = url.searchParams.get('directory');
      if (path === REFRESH_PATH) {
        let body: unknown;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          fail(response, 400, 'BAD_BODY', error instanceof Error ? error.message : 'Unreadable body');
          return;
        }
        rawDirectory = directoryFrom(body) ?? rawDirectory;
      }

      const directory = await resolveProjectDirectory(rawDirectory);
      if (!directory.ok) {
        fail(response, 400, directory.code, directory.message);
        return;
      }

      if (path === REFRESH_PATH) handlers.invalidate(directory.directory);

      let snapshot: GitSnapshot;
      try {
        snapshot = await handlers.snapshot(directory.directory);
      } catch (error) {
        fail(response, 500, 'SNAPSHOT_FAILED', error instanceof Error ? error.message : String(error));
        return;
      }
      send(response, 200, snapshot as unknown as object);
    })().catch((error: unknown) => {
      if (!response.headersSent) {
        fail(response, 500, 'INTERNAL', error instanceof Error ? error.message : String(error));
        return;
      }
      response.end();
    });
  });
};
