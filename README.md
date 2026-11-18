# openchamber-git-log

The checkout behind the chat, in an OpenChamber rail panel: the branch and its
upstream, `git status`, a flat commit list with branch and tag decorations, every
local and remote branch, and every worktree.

Nothing is ever written to the repository. The panel reads five fixed `git`
commands through a local service, and Refresh runs the same reads again.

## What it shows

1. **Header** — repository name, current branch, upstream and ± counts, the
   detached or unborn state, when the data was read, and **Refresh**.
2. **Status** — staged, modified, untracked and conflicted counts, then up to 100 rows, one per
   changed path, with its `XY` code and rename source.
3. **Log** — newest commits as one flat list, 50 rows at a time:

   ```
   a1b2c3d  fix: keep the checkout lines in the strip tooltip  [main] [v0.4.1] [origin/main]
   ```

   A row never expands. **Load more** adds 50 rows from the answer already in the
   panel, and the service returns at most the newest 500 commits.
4. **Branches** — Local and Remote lists, each row showing its upstream, ahead and
   behind counts, relative date and subject. The current branch is marked.
5. **Worktrees** — path, branch or detached HEAD, short oid, and `current`,
   `locked`, `prunable` or `bare` when they apply.

An empty repository, a detached HEAD, a folder that is not a checkout, a missing
`git`, a timeout and a truncated read each have their own state or notice. They
are not errors in the service.

## Requirements

- OpenChamber **2.6.0 or newer** (an extension with a local service and a rail panel).
- `git` on `PATH`.
- A project opened in OpenChamber. The panel follows the chat's project directory.

## Install

From **Settings → Extensions → Add**:

- **Git** — `https://github.com/jordantrizz/openchamber-git-log`. OpenChamber clones
  the repository root and installs `dist/`, so the release tag is all you need.
- **Folder** — the absolute path of this checkout, for development. Folder installs
  are watched, so an edit plus `npm run build` reloads the panel and restarts the
  service.

Then approve the local service when OpenChamber asks. The approval lists one
executable, `git`, and the `service` permission. No other capability is requested.
Without the service the panel shows "Allow the local service for Git in Settings →
Extensions".

## What it asks for

| Grant | Why | What the code does |
|-------|-----|--------------------|
| `service` (exec `git`) | Read the checkout | Five fixed argument vectors, `execFile` only, no user input reaches the command line, every call carries `--no-optional-locks` |

The service never runs `fetch`, `pull`, `checkout`, `add`, `commit`, `tag`, `stash`,
`worktree add` or any other writing command. It has no network access, no account,
no telemetry, and no persisted setting.

The five reads:

```text
git --no-optional-locks rev-parse --show-toplevel
git --no-optional-locks status --porcelain=v2 --branch -z
git --no-optional-locks for-each-ref --format=… refs/heads refs/remotes
git --no-optional-locks worktree list --porcelain
git --no-optional-locks log --no-color --no-show-signature --decorate=short --format=%h%x00%s%x00%D --max-count=500
```

## Troubleshooting

| What you see | What to do |
|--------------|------------|
| `NO_SERVICE` | Allow the local service in Settings → Extensions, then reopen the panel. |
| `git was not found` | Put `git` on the PATH OpenChamber runs with, then reopen the panel. |
| `This project is not a git checkout` | Open a project whose directory (or a parent) contains `.git`. |
| `No commits yet` | The repository is initialised but has no commit; the branch and worktree still show. |
| A path or branch list stops early | The service caps the status list at 1 000 paths and each branch side at 200 rows; the note says so. |
| `git did not answer in time` | The checkout is large or on a slow disk. Press Refresh; the other sections stay. |

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run verify:package
npm run check        # all four, in order
```

OpenChamber does not compile TypeScript. `dist/` is committed and shipped as it
sits, so run `npm run build` before every commit that changes `src/`. See
[`AGENTS.md`](AGENTS.md) for the constraints and [`PLAN.md`](PLAN.md) for the data
contract.

## License

MIT
