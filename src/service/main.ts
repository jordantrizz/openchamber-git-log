import { SnapshotCache } from './cache.ts';
import { createService } from './http.ts';
import { buildSnapshot } from './snapshot.ts';
import type { GitSnapshot } from '../shared/types.ts';

declare const __GIT_LOG_VERSION__: string;

const port = Number.parseInt(process.env.OPENCHAMBER_SERVICE_PORT ?? '', 10);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error('git-log service: OPENCHAMBER_SERVICE_PORT is missing or invalid');
  process.exit(1);
}
if (token === '') {
  console.error('git-log service: OPENCHAMBER_SERVICE_TOKEN is missing');
  process.exit(1);
}

const cache = new SnapshotCache<GitSnapshot>();

const server = createService({
  token,
  version: __GIT_LOG_VERSION__,
  handlers: {
    snapshot: (directory) => cache.get(directory, () => buildSnapshot(directory)),
    invalidate: (directory) => cache.invalidate(directory),
  },
});

server.on('error', (error) => {
  console.error(`git-log service: ${error.message}`);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`git-log service listening on 127.0.0.1:${port}`);
});

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 3000).unref();
};

for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, stop);

process.on('unhandledRejection', (reason) => {
  console.error(`git-log service: unhandled rejection: ${String(reason)}`);
});
