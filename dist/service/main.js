// src/service/cache.ts
var CACHE_TTL_MS = 1e4;
var SnapshotCache = class {
  entries = /* @__PURE__ */ new Map();
  ttlMs;
  now;
  constructor(ttlMs = CACHE_TTL_MS, now = () => Date.now()) {
    this.ttlMs = ttlMs;
    this.now = now;
  }
  get(key, load) {
    const existing = this.entries.get(key);
    if (existing && this.now() - existing.at < this.ttlMs) return existing.value;
    const value = load().catch((error) => {
      this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, { at: this.now(), value });
    return value;
  }
  invalidate(key) {
    if (key === void 0) {
      this.entries.clear();
      return;
    }
    this.entries.delete(key);
  }
};

// src/service/http.ts
import { createServer } from "node:http";

// src/service/directory.ts
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
var fail = (code, message) => ({
  ok: false,
  code,
  message
});
var resolveProjectDirectory = async (input) => {
  if (typeof input !== "string" || input.trim() === "") {
    return fail("NO_DIRECTORY", "No project directory was given");
  }
  const candidate = input.trim();
  if (candidate.includes("\0")) return fail("BAD_DIRECTORY", "The project directory contains a null byte");
  if (candidate.length > 4096) return fail("BAD_DIRECTORY", "The project directory is too long");
  if (!path.isAbsolute(candidate)) return fail("BAD_DIRECTORY", "The project directory must be absolute");
  let real;
  try {
    real = await realpath(candidate);
  } catch {
    return fail("BAD_DIRECTORY", "The project directory does not exist");
  }
  try {
    const info = await stat(real);
    if (!info.isDirectory()) return fail("BAD_DIRECTORY", "The project directory is not a directory");
  } catch {
    return fail("BAD_DIRECTORY", "The project directory does not exist");
  }
  if (real === path.parse(real).root) {
    return fail("BAD_DIRECTORY", "Refusing to run git in the filesystem root");
  }
  return { ok: true, directory: real };
};

// src/service/http.ts
var BODY_LIMIT_BYTES = 64 * 1024;
var HEALTH_PATH = "/health";
var SNAPSHOT_PATH = "/snapshot";
var REFRESH_PATH = "/refresh";
var send = (response, status, body) => {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text)
  });
  response.end(text);
};
var fail2 = (response, status, code, message) => {
  send(response, status, { ok: false, code, message });
};
var readJsonBody = (request) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  request.on("data", (chunk) => {
    size += chunk.byteLength;
    if (size > BODY_LIMIT_BYTES) {
      reject(new Error("body too large"));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (text === "") {
      resolve(null);
      return;
    }
    try {
      resolve(JSON.parse(text));
    } catch {
      reject(new Error("body is not JSON"));
    }
  });
  request.on("error", reject);
});
var bearerMatches = (header, token2) => {
  if (typeof header !== "string") return false;
  const expected = `Bearer ${token2}`;
  if (header.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < header.length; index += 1) {
    mismatch |= header.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
};
var directoryFrom = (value) => typeof value === "object" && value !== null && "directory" in value ? value.directory : void 0;
var createService = (options) => {
  const { token: token2, handlers, version = "0.1.0" } = options;
  return createServer((request, response) => {
    void (async () => {
      if (!bearerMatches(request.headers.authorization, token2)) {
        fail2(response, 401, "UNAUTHORIZED", "Missing or wrong bearer token");
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const path6 = url.pathname;
      if (path6 === HEALTH_PATH) {
        if (request.method !== "GET") {
          fail2(response, 405, "METHOD_NOT_ALLOWED", "Use GET");
          return;
        }
        send(response, 200, { ok: true, version });
        return;
      }
      if (path6 !== SNAPSHOT_PATH && path6 !== REFRESH_PATH) {
        fail2(response, 404, "NOT_FOUND", "Unknown path");
        return;
      }
      if (path6 === SNAPSHOT_PATH && request.method !== "GET") {
        fail2(response, 405, "METHOD_NOT_ALLOWED", "Use GET");
        return;
      }
      if (path6 === REFRESH_PATH && request.method !== "POST") {
        fail2(response, 405, "METHOD_NOT_ALLOWED", "Use POST");
        return;
      }
      let rawDirectory = url.searchParams.get("directory");
      if (path6 === REFRESH_PATH) {
        let body;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          fail2(response, 400, "BAD_BODY", error instanceof Error ? error.message : "Unreadable body");
          return;
        }
        rawDirectory = directoryFrom(body) ?? rawDirectory;
      }
      const directory = await resolveProjectDirectory(rawDirectory);
      if (!directory.ok) {
        fail2(response, 400, directory.code, directory.message);
        return;
      }
      if (path6 === REFRESH_PATH) handlers.invalidate(directory.directory);
      let snapshot;
      try {
        snapshot = await handlers.snapshot(directory.directory);
      } catch (error) {
        fail2(response, 500, "SNAPSHOT_FAILED", error instanceof Error ? error.message : String(error));
        return;
      }
      send(response, 200, snapshot);
    })().catch((error) => {
      if (!response.headersSent) {
        fail2(response, 500, "INTERNAL", error instanceof Error ? error.message : String(error));
        return;
      }
      response.end();
    });
  });
};

// src/service/snapshot.ts
import path5 from "node:path";

// src/shared/parse-branches.ts
var BRANCH_CAP = 200;
var FIELD_COUNT = 8;
var numbers = (track) => {
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return {
    ahead: ahead ? Number.parseInt(ahead[1] ?? "0", 10) : 0,
    behind: behind ? Number.parseInt(behind[1] ?? "0", 10) : 0
  };
};
var parseBranches = (raw, currentBranch, cap = BRANCH_CAP) => {
  const locals = [];
  const remotes = [];
  const sortKey = /* @__PURE__ */ new Map();
  let dropped = false;
  for (const line of raw.split("\n")) {
    if (line === "") continue;
    const fields = line.split("\0");
    if (fields.length < FIELD_COUNT) continue;
    const refname = fields[0] ?? "";
    const name = fields[1] ?? "";
    if (name === "") continue;
    if (refname.startsWith("refs/remotes/") && name.endsWith("/HEAD")) continue;
    const track = fields[4] ?? "";
    const counts = numbers(track);
    const row = {
      name,
      oid: fields[2] ?? "",
      upstream: (fields[3] ?? "") === "" ? null : fields[3] ?? null,
      ahead: counts.ahead,
      behind: counts.behind,
      relativeDate: fields[5] ?? "",
      subject: fields[7] ?? "",
      current: name === currentBranch
    };
    const unix = Number.parseInt(fields[6] ?? "0", 10);
    sortKey.set(row, Number.isNaN(unix) ? 0 : unix);
    if (refname.startsWith("refs/remotes/")) remotes.push(row);
    else if (refname.startsWith("refs/heads/")) locals.push(row);
  }
  const byNewest = (left, right) => (sortKey.get(right) ?? 0) - (sortKey.get(left) ?? 0);
  locals.sort(byNewest);
  remotes.sort(byNewest);
  const trim = (rows) => {
    if (rows.length <= cap) return rows;
    dropped = true;
    return rows.slice(0, cap);
  };
  return { locals: trim(locals), remotes: trim(remotes), truncated: dropped };
};

// src/shared/refs.ts
var parseDecorations = (raw) => {
  const branches = [];
  const tags = [];
  let head = false;
  for (const entry of raw.split(", ")) {
    const part = entry.trim();
    if (part === "") continue;
    if (part.startsWith("tag: ")) {
      const tag = part.slice("tag: ".length).trim();
      if (tag !== "") tags.push(tag);
      continue;
    }
    const arrow = part.indexOf(" -> ");
    if (arrow >= 0) {
      const source = part.slice(0, arrow).trim();
      const target = part.slice(arrow + 4).trim();
      if (source === "HEAD") head = true;
      if (target !== "") branches.push(target);
      continue;
    }
    if (part === "HEAD") {
      head = true;
      continue;
    }
    branches.push(part);
  }
  return { branches, tags, head };
};

// src/shared/parse-log.ts
var LOG_CAP = 500;
var parseLog = (raw, cap = LOG_CAP) => {
  const commits = [];
  for (const line of raw.split("\n")) {
    if (line === "") continue;
    const fields = line.split("\0");
    if (fields.length < 2) continue;
    const sha = fields[0] ?? "";
    if (sha === "") continue;
    const decorations = parseDecorations(fields[2] ?? "");
    commits.push({
      sha,
      subject: fields[1] ?? "",
      branches: decorations.branches,
      tags: decorations.tags,
      head: decorations.head
    });
    if (commits.length > cap) break;
  }
  return {
    commits: commits.slice(0, cap),
    capped: commits.length >= cap,
    empty: commits.length === 0
  };
};

// src/shared/parse-status.ts
var STATUS_PATH_CAP = 1e3;
var emptyCounts = () => ({ staged: 0, modified: 0, untracked: 0, conflicted: 0 });
var pathFrom = (fields, index) => fields.slice(index).join(" ");
var parseStatus = (raw, cap = STATUS_PATH_CAP) => {
  const records = raw.split("\0");
  const counts = emptyCounts();
  const files = [];
  let oid = null;
  let branch = null;
  let detached = false;
  let unborn = false;
  let upstreamName = null;
  let ahead = 0;
  let behind = 0;
  let dropped = false;
  const push = (file) => {
    if (files.length < cap) files.push(file);
    else dropped = true;
  };
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record === "") continue;
    if (record.startsWith("# ")) {
      const [key, ...rest] = record.slice(2).split(" ");
      const value = rest.join(" ").trim();
      if (key === "branch.oid") {
        if (value === "(initial)") unborn = true;
        else oid = value === "" ? null : value;
      } else if (key === "branch.head") {
        if (value === "(detached)") detached = true;
        else branch = value === "" ? null : value;
      } else if (key === "branch.upstream") {
        upstreamName = value === "" ? null : value;
      } else if (key === "branch.ab") {
        const aheadMatch = /\+\d+/.exec(value);
        const behindMatch = /-\d+/.exec(value);
        ahead = aheadMatch ? Number.parseInt(aheadMatch[0].slice(1), 10) : 0;
        behind = behindMatch ? Number.parseInt(behindMatch[0].slice(1), 10) : 0;
      }
      continue;
    }
    const kind = record[0];
    if (kind === "1" || kind === "2") {
      const fields = record.split(" ");
      const xy = fields[1] ?? "..";
      const stagedChange = (xy[0] ?? ".") !== ".";
      const worktreeChange = (xy[1] ?? ".") !== ".";
      if (stagedChange) counts.staged += 1;
      if (worktreeChange) counts.modified += 1;
      const path6 = pathFrom(fields, kind === "2" ? 9 : 8);
      const group = worktreeChange ? "modified" : "staged";
      if (kind === "2") {
        const from = records[index + 1] ?? "";
        index += 1;
        push({ path: path6, from, code: xy, group });
      } else {
        push({ path: path6, code: xy, group });
      }
      continue;
    }
    if (kind === "u") {
      const fields = record.split(" ");
      counts.conflicted += 1;
      push({ path: pathFrom(fields, 10), code: fields[1] ?? "UU", group: "conflicted" });
      continue;
    }
    if (kind === "?") {
      counts.untracked += 1;
      push({ path: record.slice(2), code: "??", group: "untracked" });
      continue;
    }
  }
  return {
    head: {
      branch: detached || unborn ? unborn ? branch : null : branch,
      detached,
      oid,
      unborn
    },
    upstream: upstreamName === null ? null : { name: upstreamName, ahead, behind },
    counts,
    files,
    truncated: dropped
  };
};

// src/shared/parse-worktrees.ts
import path2 from "node:path";
var valueAfter = (line, key) => line.slice(key.length).trim();
var parseWorktrees = (raw, repoRoot) => {
  const rows = [];
  const root = repoRoot === null ? null : path2.resolve(repoRoot);
  for (const block of raw.split(/\n\s*\n/u)) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) continue;
    let worktreePath = null;
    let oid = null;
    let branch = null;
    let detached = false;
    let bare = false;
    let locked = null;
    let prunable = null;
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        worktreePath = valueAfter(line, "worktree");
      } else if (line.startsWith("HEAD ")) {
        oid = valueAfter(line, "HEAD").slice(0, 7);
      } else if (line.startsWith("branch ")) {
        const ref = valueAfter(line, "branch");
        branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
      } else if (line === "detached") {
        detached = true;
      } else if (line === "bare") {
        bare = true;
      } else if (line.startsWith("locked")) {
        locked = valueAfter(line, "locked") === "" ? "locked" : valueAfter(line, "locked");
      } else if (line.startsWith("prunable")) {
        prunable = valueAfter(line, "prunable") === "" ? "prunable" : valueAfter(line, "prunable");
      }
    }
    if (worktreePath === null) continue;
    rows.push({
      path: worktreePath,
      branch: detached ? null : branch,
      oid,
      current: root !== null && path2.resolve(worktreePath) === root,
      detached,
      bare,
      locked,
      prunable
    });
  }
  return rows;
};

// src/shared/text.ts
var firstLine = (text) => text.split("\n").map((line) => line.trim()).find((line) => line !== "");

// src/shared/types.ts
var emptyHead = () => ({ branch: null, detached: false, oid: null, unborn: false });
var emptyStatus = () => ({
  counts: { staged: 0, modified: 0, untracked: 0, conflicted: 0 },
  files: [],
  truncated: false
});
var emptyLog = () => ({ commits: [], capped: false, empty: true });
var emptyBranches = () => ({ locals: [], remotes: [], truncated: false });

// src/service/git.ts
import path4 from "node:path";

// src/service/exec.ts
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, stat as stat2 } from "node:fs/promises";
import path3 from "node:path";
var STDOUT_LIMIT_BYTES = 256 * 1024;
var STDERR_LIMIT_BYTES = 16 * 1024;
var DEFAULT_DEADLINE_MS = 4e3;
var INHERITED_ENV = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "USER"];
var baseEnv = (source = process.env) => {
  const env = {};
  for (const key of INHERITED_ENV) {
    const value = source[key];
    if (value !== void 0) env[key] = value;
  }
  return env;
};
var refuse = (error) => ({
  ok: false,
  exitCode: null,
  signal: null,
  stdout: "",
  stderr: "",
  timedOut: false,
  truncated: false,
  error
});
var runCommand = (binary, argv, cwd, options = {}) => {
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const stdoutLimit = options.stdoutLimit ?? STDOUT_LIMIT_BYTES;
  const stderrLimit = options.stderrLimit ?? STDERR_LIMIT_BYTES;
  const env = options.env ?? baseEnv();
  return new Promise((resolve) => {
    const chunks = [];
    const errorChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;
    let spawnError = null;
    let settled = false;
    const child = spawn(binary, [...argv], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, deadlineMs);
    timer.unref?.();
    child.stdout.on("data", (chunk) => {
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
    child.stderr.on("data", (chunk) => {
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
    child.on("error", (error) => {
      spawnError = error.message;
    });
    const finish = (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: spawnError === null && !timedOut && exitCode === 0,
        exitCode,
        signal,
        stdout: Buffer.concat(chunks).toString("utf8"),
        stderr: Buffer.concat(errorChunks).toString("utf8"),
        timedOut,
        truncated,
        error: spawnError
      });
    };
    child.on("close", finish);
  });
};
var isExecutableFile = async (candidate) => {
  try {
    const info = await stat2(candidate);
    if (!info.isFile()) return false;
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};
var searchPath = async (name, searchDirs) => {
  for (const dir of searchDirs) {
    const candidate = path3.join(dir, name);
    if (await isExecutableFile(candidate)) return candidate;
  }
  return null;
};

// src/service/git.ts
var GIT_LOG_LIMIT_BYTES = 512 * 1024;
var ROOT_VECTOR = ["--no-optional-locks", "rev-parse", "--show-toplevel"];
var STATUS_VECTOR = ["--no-optional-locks", "status", "--porcelain=v2", "--branch", "-z"];
var BRANCH_VECTOR = [
  "--no-optional-locks",
  "for-each-ref",
  "--format=%(refname)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(committerdate:relative)%00%(committerdate:unix)%00%(subject)",
  "refs/heads",
  "refs/remotes"
];
var WORKTREE_VECTOR = ["--no-optional-locks", "worktree", "list", "--porcelain"];
var LOG_VECTOR = [
  "--no-optional-locks",
  "log",
  "--no-color",
  "--no-show-signature",
  "--decorate=short",
  "--format=%h%x00%s%x00%D",
  `--max-count=${LOG_CAP}`
];
var GIT_ARGV = {
  root: ROOT_VECTOR,
  status: STATUS_VECTOR,
  branches: BRANCH_VECTOR,
  worktrees: WORKTREE_VECTOR,
  log: LOG_VECTOR
};
var GIT_VECTORS = [
  ROOT_VECTOR,
  STATUS_VECTOR,
  BRANCH_VECTOR,
  WORKTREE_VECTOR,
  LOG_VECTOR
];
var isAllowedGitVector = (args) => GIT_VECTORS.some(
  (allowed) => allowed.length === args.length && allowed.every((step, index) => step === args[index])
);
var buildGitArgs = (kind) => [...GIT_ARGV[kind]];
var gitEnv = () => {
  const env = baseEnv();
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_PAGER = "cat";
  return env;
};
var resolveGitBinary = async (env = process.env) => {
  const searchDirs = (env.PATH ?? "").split(path4.delimiter).filter((dir) => dir !== "");
  const found = await searchPath("git", searchDirs);
  return found === null ? null : { path: found, source: "path" };
};
var defaultRunner = (binary, argv, cwd, kind) => {
  if (!isAllowedGitVector(argv)) return Promise.resolve(refuse("git vector is not on the allowlist"));
  return runCommand(binary, argv, cwd, {
    deadlineMs: DEFAULT_DEADLINE_MS,
    stdoutLimit: kind === "log" ? GIT_LOG_LIMIT_BYTES : STDOUT_LIMIT_BYTES,
    stderrLimit: STDERR_LIMIT_BYTES,
    env: gitEnv()
  });
};
var NOT_A_REPOSITORY = /not a git repository/iu;
var NOT_A_WORK_TREE = /must be run in a work tree/iu;
var readGit = async (directory, options = {}) => {
  const binary = options.binary === void 0 ? await resolveGitBinary() : options.binary;
  if (binary === null) {
    return {
      state: "unavailable",
      notice: {
        code: "git-missing",
        tone: "muted",
        message: "git was not found",
        detail: "The panel needs git on PATH."
      }
    };
  }
  const run = options.run ?? defaultRunner;
  const [root, status, branches, worktrees, log] = await Promise.all([
    run(binary.path, buildGitArgs("root"), directory, "root"),
    run(binary.path, buildGitArgs("status"), directory, "status"),
    run(binary.path, buildGitArgs("branches"), directory, "branches"),
    run(binary.path, buildGitArgs("worktrees"), directory, "worktrees"),
    run(binary.path, buildGitArgs("log"), directory, "log")
  ]);
  if (root.error !== null) {
    return {
      state: "unavailable",
      notice: {
        code: "git-error",
        tone: "warning",
        message: "git could not start",
        detail: root.error
      }
    };
  }
  if (root.timedOut) {
    return {
      state: "unavailable",
      notice: {
        code: "git-timeout",
        tone: "warning",
        message: `git did not answer within ${Math.round(DEFAULT_DEADLINE_MS / 1e3)} s`,
        detail: "The checkout may be large or on a slow disk."
      }
    };
  }
  if (!root.ok) {
    if (NOT_A_REPOSITORY.test(root.stderr) || NOT_A_WORK_TREE.test(root.stderr)) {
      return { state: "not-repo" };
    }
    const line = firstLine(root.stderr);
    return {
      state: "unavailable",
      notice: {
        code: "git-error",
        tone: "warning",
        message: "git could not describe this checkout",
        ...line === void 0 ? {} : { detail: line }
      }
    };
  }
  return { state: "ok", answers: { root, status, branches, worktrees, log } };
};

// src/service/snapshot.ts
var SNAPSHOT_DEADLINE_MS = 6e3;
var NO_COMMITS = /does not have any commits yet|bad default revision|ambiguous argument 'HEAD'|unknown revision/iu;
var truncatedNotice = (section) => ({
  code: `${section}-truncated`,
  tone: "muted",
  message: `The ${section} read was truncated`,
  detail: "Only the first part of the git output was used."
});
var failedNotice = (section, detail) => ({
  code: `${section}-error`,
  tone: "warning",
  message: `git ${section} did not answer`,
  ...detail === void 0 ? {} : { detail }
});
var sectionNotice = (section, result, extraTruncated = false) => {
  if (result.timedOut) return failedNotice(section, "The read took too long.");
  if (!result.ok) return failedNotice(section, firstLine(result.stderr));
  if (result.truncated || extraTruncated) return truncatedNotice(section);
  return null;
};
var emptySnapshot = (generatedAt, notices) => ({
  generatedAt,
  repo: null,
  head: emptyHead(),
  upstream: null,
  status: emptyStatus(),
  log: emptyLog(),
  branches: emptyBranches(),
  worktrees: [],
  notices
});
var readWithDeadline = async (directory, options, deadlineMs) => {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
  });
  try {
    return await Promise.race([readGit(directory, options), timeout]);
  } finally {
    if (timer !== void 0) clearTimeout(timer);
  }
};
var buildSnapshot = async (directory, options = {}) => {
  const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const deadlineMs = options.deadlineMs ?? SNAPSHOT_DEADLINE_MS;
  const read = await readWithDeadline(directory, options, deadlineMs);
  if (read === null) {
    return emptySnapshot(generatedAt, [
      {
        code: "snapshot-timeout",
        tone: "warning",
        message: `git did not answer within ${Math.round(deadlineMs / 1e3)} s`,
        detail: "The checkout may be large or on a slow disk. Refresh to try again."
      }
    ]);
  }
  if (read.state === "not-repo") return emptySnapshot(generatedAt, []);
  if (read.state === "unavailable") return emptySnapshot(generatedAt, [read.notice]);
  const answers = read.answers;
  const notices = [];
  const root = answers.root.stdout.trim();
  const repo = { root, name: path5.basename(root) };
  const status = answers.status.ok ? parseStatus(answers.status.stdout) : parseStatus("");
  const statusNotice = sectionNotice("status", answers.status, status.truncated);
  if (statusNotice) notices.push(statusNotice);
  const branches = answers.branches.ok ? parseBranches(answers.branches.stdout, status.head.branch) : emptyBranches();
  const branchesNotice = sectionNotice("branches", answers.branches, branches.truncated);
  if (branchesNotice) notices.push(branchesNotice);
  const worktrees = answers.worktrees.ok ? parseWorktrees(answers.worktrees.stdout, root) : [];
  const worktreesNotice = sectionNotice("worktrees", answers.worktrees);
  if (worktreesNotice) notices.push(worktreesNotice);
  let log = emptyLog();
  if (answers.log.timedOut) {
    notices.push(failedNotice("log", "The read took too long."));
  } else if (answers.log.ok) {
    log = parseLog(answers.log.stdout);
    if (answers.log.truncated) notices.push(truncatedNotice("log"));
  } else if (!NO_COMMITS.test(answers.log.stderr)) {
    notices.push(failedNotice("log", firstLine(answers.log.stderr)));
  }
  return {
    generatedAt,
    repo,
    head: status.head,
    upstream: status.upstream,
    status: { counts: status.counts, files: status.files, truncated: status.truncated },
    log,
    branches,
    worktrees,
    notices
  };
};

// src/service/main.ts
var port = Number.parseInt(process.env.OPENCHAMBER_SERVICE_PORT ?? "", 10);
var token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? "";
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error("git-log service: OPENCHAMBER_SERVICE_PORT is missing or invalid");
  process.exit(1);
}
if (token === "") {
  console.error("git-log service: OPENCHAMBER_SERVICE_TOKEN is missing");
  process.exit(1);
}
var cache = new SnapshotCache();
var server = createService({
  token,
  version: "0.1.0",
  handlers: {
    snapshot: (directory) => cache.get(directory, () => buildSnapshot(directory)),
    invalidate: (directory) => cache.invalidate(directory)
  }
});
server.on("error", (error) => {
  console.error(`git-log service: ${error.message}`);
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  console.log(`git-log service listening on 127.0.0.1:${port}`);
});
var stopping = false;
var stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 3e3).unref();
};
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, stop);
process.on("unhandledRejection", (reason) => {
  console.error(`git-log service: unhandled rejection: ${String(reason)}`);
});
