// The snapshot contract shared by the service and the rail panel. Field names
// are plain data, never evaluated: every value comes from git output.

export type NoticeTone = 'muted' | 'warning';

export interface Notice {
  code: string;
  tone: NoticeTone;
  message: string;
  detail?: string;
}

export interface RepoInfo {
  root: string;
  name: string;
}

export interface HeadInfo {
  /** The branch name, or null when HEAD is detached or unborn. */
  branch: string | null;
  detached: boolean;
  oid: string | null;
  unborn: boolean;
}

export interface UpstreamInfo {
  name: string;
  ahead: number;
  behind: number;
}

export type FileGroup = 'staged' | 'modified' | 'untracked' | 'conflicted';

export interface StatusFile {
  path: string;
  /** The pre-rename path, for a staged rename or copy. */
  from?: string;
  /** The two-letter XY code, or `??` for untracked. */
  code: string;
  group: FileGroup;
}

export interface StatusCounts {
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
}

export interface StatusInfo {
  counts: StatusCounts;
  files: StatusFile[];
  truncated: boolean;
}

export interface LogCommit {
  sha: string;
  subject: string;
  /** Branch refs decorating this commit, including remote branches. */
  branches: string[];
  tags: string[];
  /** The commit HEAD points at. */
  head: boolean;
}

export interface LogInfo {
  commits: LogCommit[];
  /** The service asked for its fixed cap and received that many records. */
  capped: boolean;
  empty: boolean;
}

export interface BranchRow {
  name: string;
  oid: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  relativeDate: string;
  subject: string;
  current: boolean;
}

export interface BranchesInfo {
  locals: BranchRow[];
  remotes: BranchRow[];
  truncated: boolean;
}

export interface WorktreeRow {
  path: string;
  branch: string | null;
  oid: string | null;
  current: boolean;
  detached: boolean;
  bare: boolean;
  locked: string | null;
  prunable: string | null;
}

export interface GitSnapshot {
  generatedAt: string;
  repo: RepoInfo | null;
  head: HeadInfo;
  upstream: UpstreamInfo | null;
  status: StatusInfo;
  log: LogInfo;
  branches: BranchesInfo;
  worktrees: WorktreeRow[];
  notices: Notice[];
}

/** The shape every surface renders when a directory has no checkout. */
export const emptyHead = (): HeadInfo => ({ branch: null, detached: false, oid: null, unborn: false });

export const emptyStatus = (): StatusInfo => ({
  counts: { staged: 0, modified: 0, untracked: 0, conflicted: 0 },
  files: [],
  truncated: false,
});

export const emptyLog = (): LogInfo => ({ commits: [], capped: false, empty: true });

export const emptyBranches = (): BranchesInfo => ({ locals: [], remotes: [], truncated: false });
