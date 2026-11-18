# openchamber-git-log — Plan

> Product and technical plan. The source of truth for product decisions. See
> `AGENTS.md` for the contributor handbook.

**Status:** v0.1.0 — the panels, service and docs are implemented
**Last updated:** 2026-11-18

## 1. Mission

Show the active OpenChamber project's checkout inside the chat — branch and
upstream, `git status`, a flat decorated commit log, every local and remote
branch, and every worktree — so nobody switches to a terminal to answer "where is
this repository?".

## 2. Non-goals (0.1.0)

- **No mutation.** No checkout, switch, fetch, pull, push, commit, tag, branch,
  stash, worktree or config command. Refresh only re-reads.
- **No second surface.** The extension declares one rail panel. There is no status
  strip, full-screen page, background entry, chat action, or capability.
- **No diff or file viewer.** A status row names a path; it does not open, diff or
  stage it.
- **No copy or checkout actions.** Clicking a hash, branch or worktree does nothing.
  Copy-on-click is an open decision, not a shipped feature.
- **No configurable depth.** The service asks git for 500 commits; the panel shows
  50 and grows by 50. A setting would need instance storage and is deliberately out.
- **No GitHub or remote API calls.** No network, no account, no telemetry, no
  persisted setting.

## 3. Architecture

- **Platform:** OpenChamber 2.6.0+ extension, `apiVersion: 1`.
- **Language/build:** TypeScript strict, esbuild, no UI framework. Panel is IIFE;
  service is ESM for node22.
- **Surface:** `contributes.panel` (`id: git-log`, `name: Git`) with
  `src/panel/index.html`.
- **Service:** `contributes.service`, `runtime: host`, `permissions.exec: ["git"]`.
  Listens on `127.0.0.1` with the host's bearer token.
- **Data:** one `/snapshot` JSON per project directory, served from a 10-second
  in-memory cache. `POST /refresh` invalidates and returns a fresh snapshot.
- **Deploy:** Git URL or absolute folder in Settings → Extensions; `dist/` is
  committed because the host never builds.

### Why this shape

A panel iframe cannot run a process, so reading git requires a service. The service
is also where the read-only boundary can be enforced once: a fixed vector table and
one spawn site. The panel stays a pure renderer, which keeps the bundle small and
makes the whole view testable without a browser. The commit cap is fixed in argv so
no request value can widen a command; **Load more** is a slice of data the panel
already holds.

## 4. Panel layout

Top to bottom:

1. **Header** — repo name; branch with `→ upstream · +ahead/-behind`; detached or
   unborn label; updated time; **Refresh**.
2. **Status** — four counts (staged, modified, untracked, conflicts); one row per
   changed path with its `XY` code and `old → new` for a rename; up to 100 rows.
3. **Log** — flat rows `short-sha  subject  [branch chips] [tag chips]`. `HEAD` is
   marked, local branches use the accent tone, remote branches the info tone, tags
   the success tone. 50 rows, **Load more** +50, 500 maximum, no expansion.
4. **Branches** — `Local (n)` and `Remote (n)` lists; each row has name, upstream,
   track counts, relative date and subject; the current branch is marked.
5. **Worktrees** — path, branch or detached, short oid, `current`, `locked`,
   `prunable`, `bare`.

Notices sit above the sections. A directory that is not a checkout renders a named
empty state, not a retry loop.

## 5. Data contract and vectors

The full TypeScript shape is `GitSnapshot` in `src/shared/types.ts`. Sections:

| Section | Content |
|---------|---------|
| `repo` | root and basename, or `null` outside a checkout |
| `head` | branch, detached, oid, unborn |
| `upstream` | name, ahead, behind |
| `status` | counts, files (`path`, `from?`, `code`, `group`), truncated |
| `log` | commits (`sha`, `subject`, `branches`, `tags`, `head`), capped, empty |
| `branches` | locals, remotes, truncated |
| `worktrees` | path, branch, oid, current, detached, bare, locked, prunable |
| `notices` | code, tone (`muted` or `warning`), message, optional detail |

Five fixed vectors, all run with `cwd` = the validated project directory:

| Kind | argv after `git` | Answers |
|------|------------------|---------|
| root | `--no-optional-locks rev-parse --show-toplevel` | repository root |
| status | `--no-optional-locks status --porcelain=v2 --branch -z` | branch, oid, upstream, ahead/behind, changed paths |
| branches | `--no-optional-locks for-each-ref --format=%(refname)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(committerdate:relative)%00%(committerdate:unix)%00%(subject) refs/heads refs/remotes` | every local and remote ref |
| worktrees | `--no-optional-locks worktree list --porcelain` | one block per worktree |
| log | `--no-optional-locks log --no-color --no-show-signature --decorate=short --format=%h%x00%s%x00%D --max-count=500` | newest commits and decorations |

States that are not failures: not a repository, unborn branch (`branch.oid
(initial)`), detached HEAD (`branch.head (detached)`), no remote, and an empty log
(`does not have any commits yet`). A missing `git`, a spawn error, a timeout and a
truncated read become one notice while the other sections keep their data.

Parsers:

- **Status** — `1`/`2` records split `XY`; `u` records are conflicts; `?` is
  untracked; `2` takes the following NUL field as the rename source. Capped at 1 000
  paths.
- **Branches** — the `refs/remotes/*/HEAD` symbolic row is skipped;
  `%(upstream:track)` becomes ahead/behind; each side is capped at 200 rows.
- **Worktrees** — blank-line-separated blocks; values run to the line end so paths
  with spaces survive; the root equal to the active directory is `current`.
- **Log** — `sha\0subject\0decorations`; `%D` splits into `HEAD`, branches
  (including `origin/main`) and `tag: x` tags. A subject is never split.

## 6. Permissions and trust

| Grant | Why | Boundary |
|-------|-----|----------|
| `service` (exec `git`) | Read the checkout | Five fixed vectors, `execFile` only, no user argv, `--no-optional-locks`, paths validated before use |

No `capabilities`. No network. No on-disk state. The service runs with the user's
rights, so the read-only guarantee lives in the code and tests, not in the
manifest.

## 7. Polling, caching and limits

- Panel refresh: **10 s** while the document is visible; reload on
  `visibilitychange`.
- Cache: keyed by project directory, TTL 10 s, single-flight; Refresh invalidates
  the entry and returns a fresh snapshot in the same request.
- Per-call deadline: 4 s; the whole snapshot has a 6 s deadline. Output caps:
  256 KiB stdout, 16 KiB stderr, 512 KiB for the log.
- Display caps: 100 status rows, 200 branches per side, 500 commits.
- No timer when no panel is mounted; no disk persistence.

## 8. Install and update

- **Git URL:** `https://github.com/jordantrizz/openchamber-git-log` — the
  repository root is the package.
- **Folder:** the absolute path of a checkout; watched for development.
- **Approval:** the service grant lists `git` only.
- **Update:** bump `version`, run `npm run check`, commit `dist/` with the source,
  tag `vX.Y.Z`, push, then Settings → Extensions → Update. Grants survive an
  update; uninstall/reinstall re-prompts.

## 9. Open decisions

These are deliberately not in 0.1.0:

- **Configurable log depth** — needs instance storage and a host-drawn setting, and
  the fixed 500 cap already bounds the work.
- **Click-to-copy** for a hash, branch or worktree path — no write, but it adds a
  per-row action and a toast dependency.
- **Diff/file opening** — needs the `files` capability and a diff renderer.
- **Branch/worktree actions** — checkout, switch or fetch would widen the grant to
  writing commands and change the extension's trust statement.
- **Log search or ref filter** — the flat list is intentionally plain; a filter
  would be a second state model.

## 10. Manual acceptance

Run `npm run check`, then install the folder in OpenChamber and approve the
service.

- **This checkout** — repo name, `main`, clean status, commits in the log, Local
  `main`, Remote `origin/main`, one current worktree.
- **A tagged repo** (`~/git/openchamber-pgf`) — logs show tag chips and branch chips
  on one row; `HEAD → main` is marked; no row expands.
- **More than 50 commits** — **Load more** adds 50 rows without a service call and
  the button disappears at 500 with a "newest 500" note.
- **Dirty checkout** — create an untracked file and modify a tracked one; Refresh
  updates counts and paths.
- **Not a repo** — open a non-git folder; the named empty state appears.
- **Empty repo** — a fresh `git init` shows the branch, "No commits yet", and one
  worktree.
- **Read-only** — `git status --porcelain` and `git for-each-ref` are identical
  before and after opening the panel.
