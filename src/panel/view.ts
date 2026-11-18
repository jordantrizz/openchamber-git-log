// The panel view: one git snapshot drawn as a header, status, a flat commit
// list, every branch and every worktree. The caller owns loading and polling;
// this module only builds DOM and the pure helpers its tests cover.

import type {
  BranchRow,
  GitSnapshot,
  LogCommit,
  StatusFile,
  UpstreamInfo,
} from '../shared/types.ts';
import { button, chip, el, noticeNode, section } from './dom.ts';
import type { ChipTone } from './dom.ts';

export const LOG_PAGE = 50;
export const STATUS_DISPLAY_CAP = 100;

export interface LogPage {
  shown: LogCommit[];
  total: number;
  hidden: number;
  canLoadMore: boolean;
  note: string;
}

/** The flat log is one list: `visible` rows, never an expanded record. */
export const logPage = (commits: LogCommit[], visible: number, page = LOG_PAGE): LogPage => {
  const limit = Math.min(Math.max(visible, page), commits.length);
  const shown = commits.slice(0, limit);
  const hidden = Math.max(0, commits.length - shown.length);
  return {
    shown,
    total: commits.length,
    hidden,
    canLoadMore: hidden > 0,
    note: hidden > 0 ? `${shown.length} of ${commits.length}` : `${commits.length} commits`,
  };
};

export interface RefChip {
  text: string;
  tone: ChipTone;
  title?: string;
}

/** Branch chips first, then tags, with HEAD marked ahead of both. */
export const refChips = (commit: LogCommit, remotes: ReadonlySet<string>): RefChip[] => {
  const chips: RefChip[] = [];
  if (commit.head) chips.push({ text: 'HEAD', tone: 'warning', title: 'HEAD points at this commit' });
  for (const branch of commit.branches) {
    chips.push({
      text: branch,
      tone: remotes.has(branch) ? 'info' : 'accent',
      title: remotes.has(branch) ? `Remote branch ${branch}` : `Branch ${branch}`,
    });
  }
  for (const tag of commit.tags) {
    chips.push({ text: tag, tone: 'success', title: `Tag ${tag}` });
  }
  return chips;
};

export const statusRows = (
  files: StatusFile[],
  cap = STATUS_DISPLAY_CAP,
): { rows: StatusFile[]; hidden: number } => ({
  rows: files.slice(0, cap),
  hidden: Math.max(0, files.length - cap),
});

export const trackLabel = (ahead: number, behind: number): string =>
  ahead === 0 && behind === 0 ? 'up to date' : `+${ahead}/-${behind}`;

export const branchTrack = (upstream: UpstreamInfo | null): string | null =>
  upstream === null ? null : trackLabel(upstream.ahead, upstream.behind);

export const emptyStateFor = (snapshot: GitSnapshot): { title: string; body: string } => {
  const unavailable = snapshot.notices.find((notice) =>
    ['git-missing', 'git-error', 'git-timeout', 'snapshot-timeout'].includes(notice.code),
  );
  if (unavailable) return { title: 'Git is unavailable', body: unavailable.message };
  return {
    title: 'This project is not a git checkout',
    body: 'Open a folder that contains a .git directory to see its log, status, branches and worktrees.',
  };
};

export const headerLine = (snapshot: GitSnapshot): { title: string; sub: string } => {
  if (snapshot.repo === null) {
    return { title: 'No repository', sub: 'This project is not a git checkout' };
  }
  const { head, upstream } = snapshot;
  if (head.unborn) {
    return { title: snapshot.repo.name, sub: `${head.branch ?? 'HEAD'} · no commits yet` };
  }
  if (head.detached) {
    return { title: snapshot.repo.name, sub: `detached at ${head.oid?.slice(0, 7) ?? 'unknown'}` };
  }
  const track = branchTrack(upstream);
  const sub =
    upstream === null
      ? `${head.branch ?? 'HEAD'} · no upstream`
      : `${head.branch ?? 'HEAD'} → ${upstream.name}${track === null ? '' : ` · ${track}`}`;
  return { title: snapshot.repo.name, sub };
};

const branchMeta = (row: BranchRow): string => {
  const track = row.upstream === null ? '' : ` → ${row.upstream} ${trackLabel(row.ahead, row.behind)}`;
  return `${row.relativeDate}${row.subject === '' ? '' : ` · ${row.subject}`}${track}`;
};

const kpi = (label: string, value: number): HTMLElement =>
  el('div', {
    className: 'kpi',
    children: [
      el('span', { className: 'kpi-label', text: label }),
      el('span', { className: 'kpi-value', text: String(value) }),
    ],
  });

const renderStatus = (snapshot: GitSnapshot): HTMLElement => {
  const { counts, files, truncated } = snapshot.status;
  const { rows, hidden } = statusRows(files);
  const body: (Node | string | null)[] = [
    el('div', {
      className: 'kpis',
      children: [
        kpi('Staged', counts.staged),
        kpi('Modified', counts.modified),
        kpi('Untracked', counts.untracked),
        kpi('Conflicts', counts.conflicted),
      ],
    }),
  ];

  if (rows.length === 0) {
    body.push(el('p', { className: 'muted', text: 'Working tree clean.' }));
  } else {
    body.push(
      el('ul', {
        className: 'files',
        children: rows.map((file) =>
          el('li', {
            className: 'file-row',
            children: [
              el('span', { className: 'file-code', text: file.code }),
              el('span', {
                className: 'file-path',
                text: file.from === undefined ? file.path : `${file.from} → ${file.path}`,
                title: file.path,
              }),
            ],
          }),
        ),
      }),
    );
    if (hidden > 0) body.push(el('p', { className: 'muted', text: `+${hidden} more paths` }));
    if (truncated) {
      body.push(el('p', { className: 'muted', text: 'The changed-path list is capped by the service.' }));
    }
  }

  const note = files.length === 0 ? 'clean' : `${files.length} path${files.length === 1 ? '' : 's'}`;
  return section('Status', note, body);
};

const renderLog = (
  snapshot: GitSnapshot,
  visible: number,
  onLoadMore: () => void,
): HTMLElement => {
  if (snapshot.log.empty) {
    return section('Log', 'empty', [el('p', { className: 'muted', text: 'No commits yet.' })]);
  }

  const page = logPage(snapshot.log.commits, visible);
  const remotes = new Set(snapshot.branches.remotes.map((branch) => branch.name));
  const body: (Node | string | null)[] = [
    el('ul', {
      className: 'log',
      children: page.shown.map((commit) => {
        const chips = refChips(commit, remotes);
        return el('li', {
          className: commit.head ? 'log-row log-head' : 'log-row',
          children: [
            el('span', { className: 'log-sha', text: commit.sha, title: commit.sha }),
            el('span', { className: 'log-subject', text: commit.subject }),
            ...(chips.length === 0
              ? []
              : [
                  el('span', {
                    className: 'log-refs',
                    children: chips.map((entry) => chip(entry.text, entry.tone, entry.title)),
                  }),
                ]),
          ],
        });
      }),
    }),
  ];

  if (page.canLoadMore) {
    body.push(button(`Load more (${page.hidden} left)`, onLoadMore));
  }
  if (snapshot.log.capped) {
    body.push(el('p', { className: 'muted', text: 'Only the newest 500 commits are available.' }));
  }

  const note = snapshot.log.capped ? 'newest 500' : page.note;
  return section('Log', note, body);
};

const branchRow = (row: BranchRow): HTMLElement =>
  el('li', {
    className: row.current ? 'branch-row current' : 'branch-row',
    ...(row.current ? { attrs: { 'aria-current': 'true' } } : {}),
    children: [
      el('span', { className: 'branch-name', text: row.name, title: row.name }),
      ...(row.current ? [chip('current', 'accent', 'The current branch')] : []),
      el('span', { className: 'branch-meta', text: branchMeta(row) }),
    ],
  });

const renderBranches = (snapshot: GitSnapshot): HTMLElement => {
  const { locals, remotes, truncated } = snapshot.branches;
  const body: (Node | string | null)[] = [];
  if (locals.length === 0 && remotes.length === 0) {
    body.push(el('p', { className: 'muted', text: 'No branches yet.' }));
  } else {
    body.push(el('h3', { className: 'subhead', text: `Local (${locals.length})` }));
    body.push(
      locals.length === 0
        ? el('p', { className: 'muted', text: 'No local branches.' })
        : el('ul', { className: 'branches', children: locals.map(branchRow) }),
    );
    body.push(el('h3', { className: 'subhead', text: `Remote (${remotes.length})` }));
    body.push(
      remotes.length === 0
        ? el('p', { className: 'muted', text: 'No remotes.' })
        : el('ul', { className: 'branches', children: remotes.map(branchRow) }),
    );
    if (truncated) {
      body.push(el('p', { className: 'muted', text: 'The branch list is capped at 200 per side.' }));
    }
  }
  return section('Branches', `${locals.length} local · ${remotes.length} remote`, body);
};

const renderWorktrees = (snapshot: GitSnapshot): HTMLElement => {
  const rows = snapshot.worktrees;
  if (rows.length === 0) {
    return section('Worktrees', 'none', [el('p', { className: 'muted', text: 'No worktrees.' })]);
  }
  return section(
    'Worktrees',
    `${rows.length}`,
    [
      el('ul', {
        className: 'worktrees',
        children: rows.map((row) =>
          el('li', {
            className: row.current ? 'worktree current' : 'worktree',
            children: [
              el('span', { className: 'worktree-path', text: row.path, title: row.path }),
              el('span', {
                className: 'worktree-meta',
                children: [
                  ...(row.branch === null
                    ? [chip('detached', 'warning', 'HEAD is not on a branch')]
                    : [chip(row.branch, 'accent', `Branch ${row.branch}`)]),
                  ...(row.oid === null ? [] : [el('span', { className: 'worktree-oid', text: row.oid })]),
                  ...(row.current ? [chip('current', 'success', 'The worktree the panel is reading')] : []),
                  ...(row.locked === null ? [] : [chip('locked', 'warning', row.locked)]),
                  ...(row.prunable === null ? [] : [chip('prunable', 'error', row.prunable)]),
                  ...(row.bare ? [chip('bare', 'info')] : []),
                ],
              }),
            ],
          }),
        ),
      }),
    ],
  );
};

export interface PanelOptions {
  snapshot: GitSnapshot;
  visibleCommits: number;
  updatedLabel: string;
  failure: { code: string; message: string } | null;
  busy: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
}

export const renderPanel = (root: HTMLElement, options: PanelOptions): void => {
  root.replaceChildren();
  const { snapshot } = options;
  const wrap = el('div', { className: 'wrap' });
  root.append(wrap);

  const header = headerLine(snapshot);
  wrap.append(
    el('header', {
      className: 'head',
      children: [
        el('div', {
          className: 'head-main',
          children: [
            el('h1', { className: 'title', text: header.title }),
            el('p', { className: 'sub', text: header.sub }),
          ],
        }),
        el('div', {
          className: 'head-actions',
          children: [
            el('span', { className: 'updated', text: `Updated ${options.updatedLabel}` }),
            button(options.busy ? 'Refreshing…' : 'Refresh', options.onRefresh, 'primary'),
          ],
        }),
      ],
    }),
  );

  if (options.failure) {
    wrap.append(
      noticeNode({
        tone: 'error',
        message: options.failure.code,
        detail: options.failure.message,
      }),
    );
  }

  for (const notice of snapshot.notices) wrap.append(noticeNode(notice));

  if (snapshot.repo === null) {
    const empty = emptyStateFor(snapshot);
    wrap.append(
      el('div', {
        className: 'empty',
        children: [
          el('p', { className: 'empty-title', text: empty.title }),
          el('p', { className: 'muted', text: empty.body }),
        ],
      }),
    );
    return;
  }

  wrap.append(renderStatus(snapshot));
  wrap.append(renderLog(snapshot, options.visibleCommits, options.onLoadMore));
  wrap.append(renderBranches(snapshot));
  wrap.append(renderWorktrees(snapshot));
};
