# AGENTS.md — Contributor & Coding-Agent Handbook

This file tells a human contributor or a coding agent how to work inside this
repository. `PLAN.md` holds the *why*; this file holds the *how*. If the two
disagree, `PLAN.md` is the source of truth for product decisions.

## 1. What this project is

`openchamber-git-log` is an OpenChamber extension that shows the active project's
checkout in one rail panel: branch and upstream, `git status`, a flat commit list
with branch and tag decorations, every local and remote branch, and every
worktree. It is a TypeScript package with one panel entry, one local service, and
committed build output. It is installed from a Git URL or a folder and has no
backend, database, setting or network traffic.

## 2. Non-negotiable constraints

These are safety and correctness properties, not style preferences:

1. **Read-only toward the checkout.** The service may run exactly the five `git`
   vectors in `PLAN.md` §5. Never add `fetch`, `pull`, `checkout`, `switch`, `add`,
   `commit`, `tag`, `branch`, `stash`, `worktree add/remove`, `config`, or any other
   command that writes a ref, the index, the working tree or configuration. Every
   read starts with `--no-optional-locks` and the child environment sets
   `GIT_OPTIONAL_LOCKS=0`, so a read never takes the index lock.
2. **The allowlist is code, not documentation.** Argument vectors are fixed in
   `src/service/git.ts`; every spawn goes through `src/service/exec.ts`. No request
   field reaches `argv`; the project directory is used only as `cwd` after
   validation. Log depth is fixed at 500 in argv; **Load more** slices the fetched
   array in the panel and never calls the service.
3. **`execFile`/`spawn` without a shell.** No `exec`, no `shell: true`, no string
   interpolation into a command line.
4. **Validate the working directory.** It must be absolute, exist, be a directory,
   and not be a filesystem root. Reject anything else before spawning.
5. **No network, no telemetry, no secrets.** The service reads git output only. It
   never logs environment variables, tokens or file contents, and persists nothing
   to disk.
6. **Built JavaScript is committed.** OpenChamber does not build on install. A
   package missing `dist/` fails as `missing-build`. Run `npm run build` before
   every commit that changes `src/`, and ship `dist/` with the source.
7. **The panel id is `git-log` and the extension is panel-only.** The id is the
   update identity: keeping it stable keeps the user's grants. No `page`,
   `statusSection`, `background` entry, or `capabilities` may be added without a
   recorded product decision in `PLAN.md`.
8. **No background work.** Data is produced only while the panel is visible. The
   one timer is the 10-second visible-only poll in `src/panel/main.ts`.
9. **CLI output is data.** Parsers in `src/shared/` never evaluate, shell out, or
   interpolate output into paths. Unknown lines and atoms are ignored, not thrown.

## 3. Layout

```
.
├── AGENTS.md
├── PLAN.md
├── README.md
├── package.json             # manifest under "openchamber"
├── tsconfig.json
├── icon.svg
├── scripts/
│   ├── build.mjs            # esbuild: panel IIFE + service ESM, copies html/css
│   └── verify-package.mjs   # the files install checks, without the host
├── src/
│   ├── panel/               # index.html, base.css, DOM kit, view, main
│   ├── service/             # HTTP, cache, snapshot, git vectors, exec, directory
│   └── shared/              # contract types, parsers, ref decorations
├── test/
│   ├── fixtures/            # recorded git output
│   └── *.test.ts
└── dist/                    # committed build output
    ├── panel/index.html, base.css, main.js
    └── service/main.js
```

Adding a section means: extend the contract in `src/shared/types.ts`, parse it in
`src/shared/`, compose it in `src/service/snapshot.ts`, draw it in
`src/panel/view.ts`, record a fixture and a test, then rebuild.

## 4. Commands

```bash
npm install
npm run typecheck
npm test                 # node --test --experimental-strip-types
npm run build            # esbuild panel (IIFE) + service (ESM) into dist/
npm run verify:package   # manifest + entries + stale-build check
npm run check            # typecheck, test, build, verify
```

In an interactive session, ask before `npm install` or a build.

## 5. Coding conventions

- **TypeScript:** strict, ESM, no `any` in exported types. No UI framework. Panel
  nodes are built with DOM APIs.
- **Theme:** use the host's `--oc-*` tokens and `applyHostReady`; never hard-code
  colors.
- **Errors:** structured `{ ok: false, code, message }` from the service; a notice
  or named state in the panel. A parser never throws on unknown fields.
- **Limits:** every git call has a deadline and output caps. A timeout is a visible
  state, not a retry loop.
- **Commits:** one behavior change per commit, imperative subject, conventional
  prefix. Commit and push after every change.
- **Terminology:** allowlist/denylist, not whitelist/blacklist.

## 6. Testing

- Parser tests use recorded fixtures and never need a real repository.
- Service tests inject a fake runner to cover happy path, not-a-repo, unborn,
  detached, missing binary, timeout, truncated output and every route error.
- The git boundary is covered with a real `mkdtemp` checkout: the read must leave
  `git status --porcelain` and `git for-each-ref` unchanged.
- No test may write to a real project. Use `mkdtemp` and clean up.
- Manual UI checks are listed in `PLAN.md` §10.

## 7. Security-sensitive files

- `src/service/git.ts` — the fixed vectors and the PATH-only binary resolution.
- `src/service/exec.ts` — the only spawn site: caps, deadline, child environment.
- `src/service/directory.ts` — path validation.
- `src/service/http.ts` — bearer token, body size, route and method checks.
- `src/service/snapshot.ts` — composing sections and notices.
- `src/shared/parse-*` and `refs.ts` — untrusted output treated as data.

Changes here need a second pass against the matching constraint above.

## 8. Release and update

1. Bump `version` in `package.json` (semver; OpenChamber compares this field only).
2. Run `npm run check`.
3. Commit `dist/` and the source together, tag `vX.Y.Z`, push.
4. In OpenChamber: Settings → Extensions → Update. Grants and the storage identity
   are preserved by panel id.
5. Uninstalling and reinstalling does **not** preserve grants; it re-prompts for the
   `service` permission.
