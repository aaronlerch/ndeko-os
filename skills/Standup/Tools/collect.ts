#!/usr/bin/env bun
/**
 * Standup collector — gathers the raw facts for a standup report across a repo group.
 *
 *   bun collect.ts [--since <ISO date|datetime|Nd|Nh>] [--cwd <dir>]
 *
 * Prints JSON to stdout. Deterministic and read-only apart from `git fetch`.
 * Config: <data tree>/standup.toml (data tree resolved by hooks/lib/paths.ts)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { dataRoot } from "../../../hooks/lib/paths";

type Config = {
  projects_root?: string;
  authors?: string[];
  ignore_branches?: string[];
  group?: { name: string; repos: string[]; paths?: Record<string, string> }[];
};

const HOME = homedir();
const expand = (p: string) => (p.startsWith("~/") ? join(HOME, p.slice(2)) : p);
const DATA_DIR = dataRoot();

function run(cmd: string[], cwd?: string, timeoutMs = 60_000): { ok: boolean; out: string; err: string } {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
  return { ok: r.exitCode === 0, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() };
}

function slugOf(url: string): string | null {
  const m = url.trim().match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/);
  return m ? m[1].toLowerCase() : null;
}

function originSlug(dir: string): string | null {
  const r = run(["git", "-C", dir, "remote", "get-url", "origin"]);
  return r.ok ? slugOf(r.out) : null;
}

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k: string) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return { since: get("--since"), cwd: get("--cwd") ?? process.cwd() };
}

/** Default window: from 00:00 local on the previous workday (Monday reaches back to Friday). */
function resolveSince(raw?: string): Date {
  if (raw) {
    const rel = raw.match(/^(\d+)([dh])$/);
    if (rel) return new Date(Date.now() - Number(rel[1]) * (rel[2] === "d" ? 86_400_000 : 3_600_000));
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
    throw new Error(`--since: cannot parse "${raw}" (use ISO date/datetime, Nd, or Nh)`);
  }
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  do d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

function globToRe(g: string) {
  return new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
}

/** Map remote slug -> local clone, preferring a real clone whose directory name matches the repo. */
function discoverClones(root: string, wanted: Set<string>): Map<string, string> {
  const found = new Map<string, string[]>();
  const walk = (dir: string, depth: number) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.includes(".git") && statSync(join(dir, ".git")).isDirectory()) {
      const s = originSlug(dir);
      if (s && wanted.has(s)) found.set(s, [...(found.get(s) ?? []), dir]);
      return;
    }
    if (depth >= 3) return;
    for (const e of entries) {
      if (e.startsWith(".") || e === "node_modules") continue;
      const p = join(dir, e);
      try {
        if (statSync(p).isDirectory()) walk(p, depth + 1);
      } catch {}
    }
  };
  walk(root, 0);
  const out = new Map<string, string>();
  for (const [slug, dirs] of found) {
    const name = slug.split("/")[1];
    out.set(slug, dirs.find((d) => basename(d).toLowerCase() === name) ?? dirs[0]);
  }
  return out;
}

function ancestorPids(): Set<number> {
  const s = new Set<number>();
  let pid = process.pid;
  for (let i = 0; i < 30 && pid > 1; i++) {
    s.add(pid);
    const r = run(["ps", "-o", "ppid=", "-p", String(pid)]);
    pid = Number(r.out);
    if (!r.ok || !pid) break;
  }
  return s;
}

/** Last few prompts Aaron typed into a session: the fallback when it does not answer. */
function recentPrompts(transcript: string, n = 3): string[] {
  const lines = readFileSync(transcript, "utf8").trimEnd().split("\n").slice(-400);
  const out: string[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
    try {
      const l = JSON.parse(lines[i]);
      const c = l.message?.content;
      if (l.type !== "user" || l.isMeta || typeof c !== "string" || c.startsWith("<")) continue;
      out.push(c.replace(/\s+/g, " ").slice(0, 400));
    } catch {}
  }
  return out.reverse();
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const args = parseArgs();
const since = resolveSince(args.since);
const sinceIso = since.toISOString();

const cfgPath = join(DATA_DIR, "standup.toml");
const cfg: Config = existsSync(cfgPath) ? (Bun.TOML.parse(readFileSync(cfgPath, "utf8")) as Config) : {};
const notes: string[] = [];
if (!existsSync(cfgPath)) notes.push(`no config at ${cfgPath}; reporting the current repo only`);

const top = run(["git", "-C", args.cwd, "rev-parse", "--show-toplevel"]);
const here = top.ok ? originSlug(top.out) : null;
const group = cfg.group?.find((g) => g.repos.map((r) => r.toLowerCase()).includes(here ?? ""));
if (here && !group && existsSync(cfgPath)) notes.push(`${here} is in no group; reporting it alone`);
const repos = group ? group.repos.map((r) => r.toLowerCase()) : here ? [here] : [];
if (repos.length === 0) {
  console.log(JSON.stringify({ error: `not inside a git repo with an origin remote: ${args.cwd}` }));
  process.exit(1);
}

const pinned = new Map(Object.entries(group?.paths ?? {}).map(([k, v]) => [k.toLowerCase(), expand(v)]));
const unresolved = new Set(repos.filter((r) => !pinned.has(r)));
if (here && top.ok) {
  // The current checkout may be a worktree; resolve to its main clone so refs are shared either way.
  const common = run(["git", "-C", top.out, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.ok && unresolved.has(here)) {
    pinned.set(here, common.out.replace(/\/\.git\/?$/, ""));
    unresolved.delete(here);
  }
}
const clones = new Map(pinned);
if (unresolved.size) {
  for (const [k, v] of discoverClones(expand(cfg.projects_root ?? "~/src"), unresolved)) clones.set(k, v);
}

// Merge-queue scratch refs are never work in progress.
const ignore = ["gh-readonly-queue/*", ...(cfg.ignore_branches ?? [])].map(globToRe);
const lookbackIso = new Date(since.getTime() - 30 * 86_400_000).toISOString();

const report = repos.map((slug) => {
  const dir = clones.get(slug);
  if (!dir) return { repo: slug, error: "no local clone found (add it under [group].paths)" };

  const fetch = run(["git", "-C", dir, "fetch", "--quiet", "--prune", "origin"], undefined, 120_000);
  const head = run(["git", "-C", dir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const base = head.ok ? head.out : "origin/main";
  const defaultBranch = base.replace(/^origin\//, "");

  const emails = new Set((cfg.authors ?? []).map((e) => e.toLowerCase()));
  for (const r of [run(["git", "-C", dir, "config", "user.email"]), run(["git", "config", "--global", "user.email"])])
    if (r.ok && r.out) emails.add(r.out.toLowerCase());
  const authorArgs = [...emails].map((e) => `--author=${e}`);

  // Shipped: first-parent commits on the default branch, authored by me, in the window.
  const SEP = "\x1e";
  const log = run([
    "git", "-C", dir, "log", base, "--first-parent", `--since=${sinceIso}`, ...authorArgs,
    `--format=%H%x1f%cI%x1f%s%x1f%b${SEP}`,
  ]);
  const shipped = log.out
    .split(SEP)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [sha, at, subject, body] = c.split("\x1f");
      const pr = subject.match(/\(#(\d+)\)\s*$/)?.[1] ?? subject.match(/^Merge pull request #(\d+)/)?.[1];
      return { sha: sha.slice(0, 9), at, subject, pr: pr ? Number(pr) : null, body: (body ?? "").slice(0, 1200) };
    });

  // PR context from GitHub: bodies for shipped PRs, plus my open PRs.
  const ghFields = "number,title,body,headRefName,state,isDraft,updatedAt,mergedAt";
  const closed = run(["gh", "pr", "list", "--repo", slug, "--author", "@me", "--state", "closed",
    "--search", `closed:>=${sinceIso.slice(0, 10)}`, "--limit", "1000", "--json", `${ghFields},closedAt`]);
  const open = run(["gh", "pr", "list", "--repo", slug, "--author", "@me", "--state", "open",
    "--limit", "100", "--json", ghFields]);
  const parse = (r: ReturnType<typeof run>) => (r.ok ? (JSON.parse(r.out || "[]") as any[]) : []);
  const closedPrs = parse(closed);
  const mergedPrs = closedPrs.filter((p) => p.mergedAt);
  const openPrs = parse(open);
  const ghError = closed.ok && open.ok ? undefined : (closed.err || open.err).slice(0, 300);
  const prBody = new Map(mergedPrs.map((p) => [p.number, p]));
  for (const s of shipped) {
    const p = s.pr ? prBody.get(s.pr) : undefined;
    if (p) Object.assign(s, { title: p.title, body: (p.body ?? "").slice(0, 1200) });
  }

  // In progress: branches (local or origin) with my commits in the window whose work has not
  // already landed. Squash merges and agent branches adopted into a bigger PR defeat
  // `git log base..branch`, so a branch counts as landed if ANY of these holds:
  //   - merging it into the default branch changes nothing (merge-tree);
  //   - a PR from it merged, or was closed unmerged (abandoned), after its last commit
  //     (looked up per branch: GitHub search lags and can miss a just-closed PR, 2026-10-14);
  //   - every one of its commit subjects appears in a recent default-branch message
  //     (squash bodies list constituent subjects).
  // A branch sharing its tip commit with a landed or reported branch is the same work.
  const closedAfter = (name: string, at: string) => {
    const r = run(["gh", "pr", "list", "--repo", slug, "--head", name, "--state", "closed", "--json", "closedAt"]);
    return r.ok && (JSON.parse(r.out || "[]") as { closedAt: string }[]).some((p) => new Date(p.closedAt) >= new Date(at));
  };
  const landedText = run(["git", "-C", dir, "log", base, `--since=${lookbackIso}`, "--format=%s%n%b"]).out.toLowerCase();
  const norm = (subject: string) => subject.replace(/\s*\(#\d+\)\s*$/, "").trim().toLowerCase();
  const baseTree = run(["git", "-C", dir, "rev-parse", `${base}^{tree}`]).out;
  const refs = run(["git", "-C", dir, "for-each-ref", "--format=%(refname)%09%(committerdate:iso-strict)%09%(objectname)",
    "refs/heads", "refs/remotes/origin"]).out.split("\n").filter(Boolean);
  const byName = new Map<string, { ref: string; local: boolean; remote: boolean; at: string }>();
  const tipOf = new Map<string, string>();
  for (const line of refs) {
    const [ref, at, tip] = line.split("\t");
    tipOf.set(ref, tip);
    if (new Date(at) < since) continue;
    const local = ref.startsWith("refs/heads/");
    const name = ref.replace(/^refs\/(heads|remotes\/origin)\//, "");
    if (name === "HEAD" || name === defaultBranch || ref === "refs/remotes/origin" || ignore.some((re) => re.test(name))) continue;
    const prev = byName.get(name);
    byName.set(name, {
      ref: !prev || at > prev.at ? ref : prev.ref,
      at: !prev || at > prev.at ? at : prev.at,
      local: local || !!prev?.local,
      remote: !local || !!prev?.remote,
    });
  }
  const openByHead = new Map(openPrs.map((p) => [p.headRefName, p]));
  const branches = [];
  const settledTips = new Set<string>();
  const candidates = [];
  for (const [name, b] of byName) {
    const mine = run(["git", "-C", dir, "log", `${base}..${b.ref}`, `--since=${sinceIso}`, ...authorArgs,
      "--no-merges", "--format=%s"]).out.split("\n").filter(Boolean);
    if (mine.length === 0) continue;
    const mt = run(["git", "-C", dir, "merge-tree", "--write-tree", base, b.ref]);
    if (
      (mt.ok && mt.out.split("\n")[0] === baseTree) ||
      mine.every((subj) => landedText.includes(norm(subj))) ||
      (!openByHead.has(name) && closedAfter(name, b.at))
    ) {
      settledTips.add(tipOf.get(b.ref)!);
      continue;
    }
    candidates.push({ name, b, mine });
  }
  // Pushed and PR-backed branches first, so a local twin collapses into them.
  candidates.sort((x, y) => Number(openByHead.has(y.name)) - Number(openByHead.has(x.name)) || Number(y.b.remote) - Number(x.b.remote));
  for (const { name, b, mine } of candidates) {
    const tip = tipOf.get(b.ref)!;
    if (settledTips.has(tip)) continue;
    settledTips.add(tip);
    const pr = openByHead.get(name);
    branches.push({
      branch: name, last_commit: b.at, local: b.local, pushed: b.remote,
      commits: mine.slice(0, 15), commit_count: mine.length,
      open_pr: pr ? { number: pr.number, title: pr.title, draft: pr.isDraft, body: (pr.body ?? "").slice(0, 600) } : null,
    });
  }
  const branchNames = new Set(branches.map((b) => b.branch));
  const openPrsWithoutRecentBranch = openPrs
    .filter((p) => new Date(p.updatedAt) >= since && !branchNames.has(p.headRefName))
    .map((p) => ({ number: p.number, title: p.title, draft: p.isDraft, branch: p.headRefName }));

  return {
    repo: slug, clone: dir, default_branch: defaultBranch,
    fetch_ok: fetch.ok, gh_error: ghError,
    shipped, in_progress_branches: branches, open_prs_other: openPrsWithoutRecentBranch,
  };
});

// Live Claude sessions working inside any repo of the group, excluding the one running this.
const sessionsDir = join(HOME, ".claude", "sessions");
const mine = ancestorPids();
const sessions = [];
if (existsSync(sessionsDir)) {
  for (const f of readdirSync(sessionsDir).filter((f) => f.endsWith(".json"))) {
    let s: any;
    try {
      s = JSON.parse(readFileSync(join(sessionsDir, f), "utf8"));
    } catch {
      continue;
    }
    if (!s.pid || !alive(s.pid) || mine.has(s.pid) || !s.cwd || !existsSync(s.cwd)) continue;
    const slug = originSlug(s.cwd);
    if (!slug || !repos.includes(slug)) continue;
    const transcript = join(HOME, ".claude", "projects", s.cwd.replace(/[^A-Za-z0-9]/g, "-"), `${s.sessionId}.jsonl`);
    sessions.push({
      name: s.name, repo: slug, cwd: s.cwd, status: s.status, kind: s.kind,
      last_active: s.updatedAt ? new Date(s.updatedAt).toISOString() : null,
      branch: run(["git", "-C", s.cwd, "branch", "--show-current"]).out || null,
      recent_prompts: existsSync(transcript) ? recentPrompts(transcript) : [],
    });
  }
}

console.log(JSON.stringify({ since: sinceIso, group: group?.name ?? null, here, notes, repos: report, sessions }, null, 2));
