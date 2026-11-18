// The rail panel: the open project's checkout. Loading, polling and errors
// live here; the view itself is a pure snapshot renderer.

import { connectHost, HostRequestError } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';

import type { GitSnapshot } from '../shared/types.ts';
import { el } from './dom.ts';
import { LOG_PAGE, renderPanel } from './view.ts';

const host = connectHost();
const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('Git panel: #root is missing');

const REFRESH_MS = 10_000;

let directory: string | null = null;
let snapshot: GitSnapshot | null = null;
let failure: { code: string; message: string } | null = null;
let busy = false;
let visibleCommits = LOG_PAGE;
let timer: ReturnType<typeof setInterval> | null = null;

class ServiceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.status = status;
  }
}

const describeError = (error: unknown): { code: string; message: string } => {
  if (error instanceof ServiceError) return { code: error.code, message: error.message };
  if (error instanceof HostRequestError) {
    switch (error.code) {
      case 'NO_SERVICE':
        return {
          code: error.code,
          message: 'Allow the local service for Git in Settings → Extensions, then reopen this panel.',
        };
      case 'SERVICE_FAILED':
        return { code: error.code, message: 'The Git service stopped. Reopen the panel to restart it.' };
      case 'REQUEST_FAILED':
      case 'HOST_TIMEOUT':
        return { code: error.code, message: 'The Git service did not answer in time.' };
      case 'DISABLED':
        return { code: error.code, message: 'Git is paused in Settings → Extensions.' };
      default:
        return { code: error.code, message: error.message };
    }
  }
  return { code: 'UNEXPECTED', message: error instanceof Error ? error.message : String(error) };
};

const callService = async <T,>(request: {
  method: 'GET' | 'POST';
  path: string;
}): Promise<T> => {
  if (!directory) throw new ServiceError('NO_DIRECTORY', 'No project is open', 400);
  const response = await host.serviceRequest({
    method: request.method,
    path: request.path,
    query: { directory },
  });
  const text = response.body.trim();
  const parsed: unknown = text === '' ? null : JSON.parse(text);
  if (response.status >= 400) {
    const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const code = typeof record.code === 'string' ? record.code : 'HTTP_ERROR';
    const message = typeof record.message === 'string' ? record.message : `The service answered ${response.status}`;
    throw new ServiceError(code, message, response.status);
  }
  return parsed as T;
};

const updatedLabel = (): string => {
  if (!snapshot) return '—';
  const at = new Date(snapshot.generatedAt);
  if (Number.isNaN(at.getTime())) return '—';
  return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const load = async (invalidate = false): Promise<void> => {
  if (!directory || busy) return;
  busy = true;
  render();
  try {
    const next = invalidate
      ? await callService<GitSnapshot>({ method: 'POST', path: '/refresh' })
      : await callService<GitSnapshot>({ method: 'GET', path: '/snapshot' });
    if (next.repo?.root !== snapshot?.repo?.root) visibleCommits = LOG_PAGE;
    snapshot = next;
    failure = null;
  } catch (error) {
    failure = describeError(error);
  } finally {
    busy = false;
    render();
  }
};

const emptyState = (title: string, body: string, action?: { label: string; onClick: () => void }): void => {
  const wrap = el('div', { className: 'wrap' });
  const card = el('div', {
    className: 'empty',
    children: [el('p', { className: 'empty-title', text: title }), el('p', { className: 'muted', text: body })],
  });
  wrap.append(card);
  if (action) {
    const button = el('button', {
      className: 'btn btn-outline',
      text: action.label,
      attrs: { type: 'button' },
    });
    button.addEventListener('click', action.onClick);
    wrap.append(button);
  }
  root?.replaceChildren(wrap);
};

const render = (): void => {
  if (!root) return;

  if (!directory) {
    emptyState('Open a project', 'The Git panel shows the checkout this chat works in.');
    return;
  }

  if (!snapshot) {
    if (failure) {
      emptyState(failure.code, failure.message, {
        label: 'Try again',
        onClick: () => {
          failure = null;
          void load();
        },
      });
      return;
    }
    const wrap = el('div', { className: 'wrap' });
    wrap.append(
      el('div', {
        className: 'loading',
        attrs: { 'aria-live': 'polite' },
        children: [
          el('span', { className: 'spinner', attrs: { 'aria-hidden': 'true' } }),
          el('span', { text: 'Reading the checkout' }),
        ],
      }),
    );
    root.replaceChildren(wrap);
    return;
  }

  renderPanel(root, {
    snapshot,
    visibleCommits,
    updatedLabel: updatedLabel(),
    failure,
    busy,
    onLoadMore: () => {
      visibleCommits += LOG_PAGE;
      render();
    },
    onRefresh: () => {
      void load(true);
    },
  });
};

const resetFor = (nextDirectory: string | null): void => {
  directory = nextDirectory;
  snapshot = null;
  failure = null;
  visibleCommits = LOG_PAGE;
  render();
  if (directory) void load();
};

host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  if (context.directory !== directory) resetFor(context.directory);
});

host.onDirectory((nextDirectory) => {
  resetFor(nextDirectory);
});

if (timer) clearInterval(timer);
timer = setInterval(() => {
  if (document.visibilityState === 'visible' && directory && !busy) void load();
}, REFRESH_MS);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && directory && !busy) void load();
});

render();
