#!/usr/bin/env bun
/**
 * privacy-scan.ts — the boundary check, at the boundary that matters.
 *
 * WHY THIS EXISTS SEPARATELY FROM PrivacyBoundary.hook.ts
 *
 * PrivacyBoundary fires on Write|Edit and catches content *I* am about to put
 * into the tree. It cannot catch three things:
 *
 *   1. Content Aaron writes by hand, or that any other tool writes.
 *   2. Content already in the tree from before the hook existed. (This is not
 *      hypothetical: the destructive-SQL fixtures carried a real container name
 *      and DB username for a day, because they predated the denylist.)
 *   3. Whole-file properties — a committed binary, an oversized blob — which
 *      are not visible in the text of a single edit.
 *
 * Git's index is the last place all three converge, so that is where the gate
 * belongs. The scanner is deliberately the SAME code in both modes:
 *
 *   --staged   what `git commit` is about to record   (the pre-commit hook)
 *   --all      every tracked file in the tree         (the pre-release audit)
 *
 * One implementation means the release audit cannot drift from the commit gate
 * and quietly start checking something weaker.
 *
 * TERM LIST PROVENANCE
 *
 * The denylist is loaded from the data tree, never from this repo — writing
 * employer and customer names into the repo they must stay out of is the exact
 * failure this guards against. `loadDenylist` and `scan` are imported from
 * PrivacyBoundary rather than reimplemented, so the two gates cannot disagree
 * about what a match is.
 *
 * FAILING OPEN ON A MISSING DENYLIST, DELIBERATELY
 *
 * Same choice PrivacyBoundary makes, for the same reason: a fresh clone has no
 * data tree, and a gate that hard-failed there would make the repo uncommittable
 * rather than safe. Structural, binary, size and path checks still run. The gap
 * is printed loudly, never swallowed.
 *
 * ESCAPE HATCHES
 *
 *   - `git commit --no-verify` skips the hook entirely. Standard git, and the
 *     right lever when you know what you are doing.
 *   - `privacy-gate:allow` on a line, or on the line above it, exempts that line
 *     from the credential and structural patterns. Those describe a SHAPE, and
 *     a test suite or a doc legitimately needs to write the shape down — without
 *     the hatch this scanner's own tests could not exist.
 *
 *     Denylisted TERMS are never exemptible. Those are real names, and no amount
 *     of commenting makes a real name belong in a public repo. The asymmetry is
 *     deliberate: a shape is safe to write, an identity is not.
 *
 * HISTORY AND MESSAGES (2026-09-27)
 *
 * The release flow publishes this repo's HISTORY, not just its tree, and two
 * things escaped every check before this: commit MESSAGES (nothing scanned them;
 * two named an internal repo) and SYMLINKS in `--all` (statSync followed each
 * link to its target and skipped it, so three links to an absolute home path
 * read as clean). `--message` backs the commit-msg hook; `--history` is the
 * pre-release audit over every added line and every message in a range.
 *
 * Usage:
 *   bun tools/privacy-scan.ts --staged            scan the git index (exit 1 on any hit)
 *   bun tools/privacy-scan.ts --all               scan every tracked file
 *   bun tools/privacy-scan.ts --all -q            exit code only, no output
 *   bun tools/privacy-scan.ts --message <file>    scan a commit message (commit-msg hook)
 *   bun tools/privacy-scan.ts --history [<range>] scan added lines + messages of every
 *                                                 commit in <range> (default: all of HEAD)
 */

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadDenylist, scan, denylistFile } from "../hooks/PrivacyBoundary.hook.ts";
import { harnessRoot } from "../hooks/lib/paths.ts";

/** Largest a tracked file may be. The harness is text; anything this big is a
 *  mistake. The repo being replaced carried a 7.6 MB PNG and six multi-megabyte
 *  session transcripts in its history, none of them deliberate. */
const MAX_BYTES = 256 * 1024;

/** Extensions that are never text, so never belong in a config repo. Checked in
 *  addition to the NUL-byte sniff below, because an extension is a statement of
 *  intent and catches an empty placeholder the sniff would pass. */
const BINARY_EXT =
  /\.(png|jpe?g|gif|bmp|tiff?|ico|webp|avif|mp[34]|mov|avi|mkv|wav|flac|pdf|zip|gz|bz2|xz|7z|rar|tar|dmg|pkg|exe|dll|so|dylib|class|jar|wasm|sqlite3?|db|pyc|woff2?|ttf|otf|eot)$/i;

/**
 * Paths that must never be committed regardless of content. `.gitignore` already
 * covers these; this is the second layer, because an ignore rule is one `git add
 * -f` away from irrelevant and these are the highest-consequence paths in the
 * tree. Every one of them is a place personal data actually accumulates.
 */
const FORBIDDEN_PATHS: Array<{ re: RegExp; why: string }> = [
  { re: /^memory\//, why: "memory belongs in the data tree" },
  { re: /^identity\//, why: "identity belongs in the data tree" },
  { re: /^state\//, why: "state belongs in the data tree" },
  { re: /^goals\.md$/, why: "goals belong in the data tree" },
  { re: /^(sessions|projects|tasks|teams|file-history|paste-cache)\//, why: "session runtime holds transcripts" },
  { re: /(^|\/)transcript\.jsonl$/, why: "raw session transcript" },
  { re: /(^|\/)\.env(\.|$)/, why: "environment file" },
  { re: /\.(pem|key|p12|pfx|keystore)$/, why: "key material" },
  { re: /^skills\/_/, why: "private skills are machine-local by convention" },
  { re: /(^|\/)\.DS_Store$/, why: "macOS noise" },
];

/**
 * Credential shapes. Tight on purpose: a loose high-entropy heuristic on a repo
 * that is 90% prose would fire constantly and train the reader to pass -n.
 */
const CREDENTIALS: Array<{ label: string; re: RegExp }> = [
  { label: "Anthropic-style key", re: /\bsk-ant-[A-Za-z0-9_-]{24,}/ },
  { label: "OpenAI-style key", re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { label: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}|\bgithub_pat_[A-Za-z0-9_]{22,}/ },
  { label: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { label: "generic bearer token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}={0,2}/ },
];

/**
 * Opts a line out of the credential patterns only. Honoured on the matching line
 * itself or on the line immediately above it, the way every linter's disable
 * comment works — a one-line marker cannot carry its own justification, and a
 * suppression without a stated reason is the kind that outlives its reason.
 */
const INLINE_ALLOW = /privacy-gate:allow/;

export interface Finding {
  file: string;
  line: number | null;
  label: string;
  match: string;
}

const root = harnessRoot();

/** Collapse $HOME to ~ so output is copy-pasteable and carries no username —
 *  same reason install.sh does it. */
const tilde = (p: string): string => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);

/** The data tree, derived from the denylist's own location so the two can never
 *  name different directories. */
const dataDir = denylistFile().replace(/\/[^/]+$/, "");

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Files git is about to record: added, copied, modified, renamed. Deletions
 *  carry no content and are skipped. */
function stagedFiles(): string[] {
  return git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    .split("\0")
    .filter(Boolean);
}

function trackedFiles(): string[] {
  return git("ls-files", "-z").split("\0").filter(Boolean);
}

/** Staged content, which is what actually gets committed — NOT the working-tree
 *  copy. Those differ whenever a file is partially staged, and the committed
 *  bytes are the ones that matter. */
function stagedBytes(file: string): Buffer | null {
  try {
    return execFileSync("git", ["show", `:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function worktreeBytes(file: string): Buffer | null {
  const p = join(root, file);
  try {
    // A symlink's committed content is its target PATH. Following the link (as
    // statSync does) scans the wrong bytes, or skips a link to a directory.
    if (lstatSync(p).isSymbolicLink()) return Buffer.from(readlinkSync(p), "utf8");
  } catch {
    return null;
  }
  if (!existsSync(p)) return null;
  try {
    return statSync(p).isFile() ? readFileSync(p) : null;
  } catch {
    return null;
  }
}

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

/** Mode bits git reports for a symlink. */
const SYMLINK_MODE = "120000";

/** An absolute symlink target only resolves on the machine that made it. */
export function absoluteLinkTarget(file: string, target: string): Finding | null {
  return target.startsWith("/")
    ? { file, line: null, label: "absolute symlink target (machine-specific; link relatively or keep it untracked)", match: target }
    : null;
}

/** Term, structural and credential checks on free text (a message, an added line). */
export function scanText(where: string, text: string, denylist: string[]): Finding[] {
  const out: Finding[] = [];
  for (const hit of scan(text, denylist)) out.push({ file: where, line: hit.line ?? null, label: hit.label, match: hit.match });
  const lines = text.split("\n");
  lines.forEach((t, i) => {
    if (INLINE_ALLOW.test(t) || (i > 0 && INLINE_ALLOW.test(lines[i - 1]!))) return;
    for (const { label, re } of CREDENTIALS) {
      const m = t.match(re);
      if (m) out.push({ file: where, line: i + 1, label, match: m[0] });
    }
  });
  return out;
}

/** A commit message as git hands it to commit-msg: `#` lines are stripped by git. */
export function scanMessage(message: string, denylist: string[]): Finding[] {
  const body = message.split("\n").filter((l) => !l.startsWith("#")).join("\n");
  return scanText("commit message", body, denylist);
}

/**
 * Every added line and every full message in `range`. Added lines are scanned one
 * at a time, so an inline allow only counts when it sits on the added line itself.
 */
export function scanHistory(range: string, denylist: string[]): { commits: number; findings: Finding[] } {
  const findings: Finding[] = [];
  const shas = git("rev-list", range).split("\n").filter(Boolean);
  for (const sha of shas) {
    const short = sha.slice(0, 7);
    findings.push(...scanMessage(git("log", "-1", "--format=%B", sha), denylist).map((f) => ({ ...f, file: `${short} message` })));
    const patch = git("show", "--format=", "--no-color", "--no-ext-diff", "-U0", sha);
    let file = "", linkNext = false, prev: string | null = null;
    for (const line of patch.split("\n")) {
      if (line.startsWith("diff --git ")) { file = line.split(" b/")[1] ?? line; linkNext = false; prev = null; continue; }
      if (line.startsWith(`new file mode ${SYMLINK_MODE}`) || line.startsWith(`new mode ${SYMLINK_MODE}`)) { linkNext = true; continue; }
      if (line.startsWith("@@")) { prev = null; continue; }
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      const added = line.slice(1);
      const where = `${short} ${file}`;
      if (linkNext) { const f = absoluteLinkTarget(where, added); if (f) findings.push(f); }
      // Scan with the previous added line in view so an allow marker on the line
      // above is honoured, the same as in a file scan; keep only this line's hits.
      const text = prev === null ? added : `${prev}\n${added}`;
      const last = prev === null ? 1 : 2;
      findings.push(...scanText(where, text, denylist).filter((f) => f.line === last).map((f) => ({ ...f, line: null })));
      prev = added;
    }
  }
  return { commits: shas.length, findings };
}

export function scanFile(file: string, buf: Buffer, denylist: string[], isLink = false): Finding[] {
  const out: Finding[] = [];

  if (isLink) {
    const f = absoluteLinkTarget(file, buf.toString("utf8"));
    if (f) out.push(f);
  }

  for (const { re, why } of FORBIDDEN_PATHS) {
    if (re.test(file)) out.push({ file, line: null, label: `forbidden path — ${why}`, match: file });
  }

  if (buf.byteLength > MAX_BYTES) {
    out.push({
      file,
      line: null,
      label: `oversized (${(buf.byteLength / 1024).toFixed(0)} KB > ${MAX_BYTES / 1024} KB)`,
      match: file,
    });
  }
  if (BINARY_EXT.test(file) || isBinary(buf)) {
    out.push({ file, line: null, label: "binary file", match: file });
    return out; // Text checks below are meaningless on binary content.
  }

  // Term and structural checks come from PrivacyBoundary so the two gates cannot
  // disagree; it is line-aware and honours the inline allow for structural hits.
  const content = buf.toString("utf8");
  for (const hit of scan(content, denylist)) {
    out.push({ file, line: hit.line ?? null, label: hit.label, match: hit.match });
  }

  const lines = content.split("\n");
  lines.forEach((text, i) => {
    if (INLINE_ALLOW.test(text) || (i > 0 && INLINE_ALLOW.test(lines[i - 1]!))) return;
    for (const { label, re } of CREDENTIALS) {
      const m = text.match(re);
      if (m) out.push({ file, line: i + 1, label, match: m[0] });
    }
  });

  return out;
}

/** Paths git records as symlinks, in the index. */
function linkPaths(): Set<string> {
  const out = new Set<string>();
  for (const rec of git("ls-files", "-s", "-z").split("\0")) {
    if (rec.startsWith(`${SYMLINK_MODE} `)) out.add(rec.split("\t")[1]!);
  }
  return out;
}

function report(findings: Finding[], label: string, clean: string, denylist: string[], quiet: boolean): never {
  if (quiet) process.exit(findings.length ? 1 : 0);
  if (!denylist.length) {
    process.stderr.write(
      `privacy-scan: no denylist at ${tilde(denylistFile())} — structural, path, binary and size checks only.\n` +
        `             Term checks are SKIPPED. This is expected on a fresh clone.\n\n`,
    );
  }
  if (!findings.length) {
    process.stderr.write(`privacy-scan: clean — ${clean}, ${denylist.length} term${denylist.length === 1 ? "" : "s"}.\n`);
    process.exit(0);
  }
  process.stderr.write(`\nprivacy-scan: ${findings.length} finding(s) in ${label}\n\n`);
  for (const f of findings) {
    const at = f.line === null ? f.file : `${f.file}:${f.line}`;
    process.stderr.write(`  ${at}\n    ${f.label}: ${JSON.stringify(f.match)}\n`);
  }
  process.stderr.write(
    `\nThis repo is public. Move the content to the data tree (${tilde(dataDir)}),\n` +
      `put it in a private skill (skills/_*), or rewrite it generically.\n` +
      `Credential-pattern false positives can carry a "privacy-gate:allow" comment on the line\n` +
      `or the line above it.\n` +
      `To commit anyway: git commit --no-verify\n\n`,
  );
  process.exit(1);
}

function main(): void {
  const argv = process.argv.slice(2);
  const quiet = argv.includes("-q") || argv.includes("--quiet");
  const denylist = loadDenylist();

  const mi = argv.indexOf("--message");
  if (mi !== -1) {
    const findings = scanMessage(readFileSync(argv[mi + 1]!, "utf8"), denylist);
    report(findings, "COMMIT MESSAGE", "commit message", denylist, quiet);
  }
  const hi = argv.indexOf("--history");
  if (hi !== -1) {
    const next = argv[hi + 1];
    const range = next && !next.startsWith("-") ? next : "HEAD";
    const { commits, findings } = scanHistory(range, denylist);
    report(findings, `HISTORY (${range})`, `${commits} commit${commits === 1 ? "" : "s"} in ${range}`, denylist, quiet);
  }

  const mode = argv.includes("--all") ? "all" : "staged";
  const files = mode === "all" ? trackedFiles() : stagedFiles();
  const read = mode === "all" ? worktreeBytes : stagedBytes;
  const links = linkPaths();

  const findings: Finding[] = [];
  for (const f of files) {
    const buf = read(f);
    if (buf) findings.push(...scanFile(f, buf, denylist, links.has(f)));
  }

  const what = mode === "all" ? "tracked" : "staged";
  report(findings, mode === "all" ? "TRACKED TREE" : "STAGED CHANGES", `${files.length} ${what} file${files.length === 1 ? "" : "s"}`, denylist, quiet);
}

if (import.meta.main) main();
