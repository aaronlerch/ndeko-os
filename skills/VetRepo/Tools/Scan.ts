#!/usr/bin/env bun
/**
 * VetRepo / Scan.ts — STATIC safety scanner for an UNTRUSTED, freshly-cloned repo.
 *
 * USAGE
 *   bun run Scan.ts <repo-path> [--json] [--online] [--include-deps] [--help]
 *
 * WHAT IT IS
 *   A heuristic, read-only evidence gatherer that grades a third-party repository
 *   against 7 MECE threat primitives (A–G) so a human or model can decide whether
 *   the repo is safe to adopt. It produces SIGNAL, not a verdict.
 *
 * SAFETY GUARANTEE (the entire point)
 *   This tool performs STATIC ANALYSIS ONLY. It NEVER executes, imports, requires,
 *   evals, builds, installs, or runs ANY code from the target repository, and never
 *   runs the target's scripts. It opens files and reads them AS TEXT. The only
 *   subprocess it will ever spawn is an OPT-IN dependency-vulnerability check
 *   (`osv-scanner` or `npm audit`) gated behind the `--online` flag — and even that
 *   never executes target code, only inspects manifests/lockfiles. Symlinks are never
 *   followed out of the repo root. The scanner degrades gracefully: unreadable files,
 *   binary files, huge files, and unknown ecosystems are skipped, never fatal.
 *
 * OFFLINE BY DEFAULT. No network access unless `--online` is passed.
 *
 * EXIT CODES
 *   0  successful scan (regardless of how many findings)
 *   1  usage error (bad/missing path, bad flags)
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

type Primitive = "A" | "B" | "C" | "D" | "E" | "F" | "G";
type Severity = "info" | "low" | "medium" | "high" | "critical";

interface Finding {
  primitive: Primitive;
  category: string;
  severity: Severity;
  file: string; // repo-relative
  line: number; // 1-based
  snippet: string;
  note?: string;
}

interface LifecycleScript {
  name: string;
  body: string;
  severity: Severity;
  file: string; // repo-relative
}

interface SecretFinding {
  file: string; // repo-relative
  line: number;
  kind: string;
  note: string;
}

interface DependencyReport {
  count: number;
  unpinned: number;
  urlOrGit: string[];
  file: string[];
}

interface OnlineReport {
  ran: boolean;
  tool: string | null;
  advisories: unknown[];
  note?: string;
}

interface ScanStats {
  filesScanned: number;
  filesSkipped: number;
  bytesScanned: number;
}

interface ScanResult {
  repo: string;
  scannedAt: string;
  ecosystems: string[];
  stats: ScanStats;
  lockfiles: string[];
  dependencies: DependencyReport;
  lifecycleScripts: LifecycleScript[];
  findings: Finding[];
  secrets: SecretFinding[];
  largestFiles: Array<{ file: string; bytes: number }>;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    byPrimitive: Record<Primitive, number>;
  };
  online: OnlineReport;
}

interface Options {
  json: boolean;
  online: boolean;
  includeDeps: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// Tunable limits (kept conservative so a few-thousand-file repo stays fast)
// ───────────────────────────────────────────────────────────────────────────

const MAX_LINE_SCAN_BYTES = 2 * 1024 * 1024; // skip line-scan for files > 2MB (still noted)
const SNIPPET_MAX = 160;
const MAX_WORKSPACE_DEPTH = 4; // nested package.json discovery depth
const MAX_FINDINGS_PER_RULE_PER_FILE = 20; // avoid pathological output on minified blobs
const ONLINE_TIMEOUT_MS = 60_000;
const MINIFIED_LINE_THRESHOLD = 2000; // a single source line longer than this => "minified shipped as source"

// Directories whose CONTENTS are skipped for line-level pattern scanning by
// default. Their PRESENCE is still detected, and root/workspace manifests are
// still parsed. `--include-deps` re-enables scanning node_modules/vendor/dist.
const NOISE_DIRS = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".venv",
  "venv",
  "target",
  ".next",
  ".turbo",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  "coverage",
]);

// Dirs that --include-deps will re-enable scanning for (the rest stay skipped).
const INCLUDE_DEPS_DIRS = new Set(["node_modules", "vendor", "dist", "build"]);

// File extensions / names we attempt to line-scan as text source.
const SOURCE_EXT = new Set([
  ".js", ".cjs", ".mjs", ".jsx", ".ts", ".cts", ".mts", ".tsx",
  ".py", ".rb", ".go", ".rs", ".sh", ".bash", ".zsh", ".ps1",
  ".json", ".yaml", ".yml", ".toml", ".mk", ".cfg", ".ini",
  ".env", ".txt", ".md",
]);

const SOURCE_FILENAMES = new Set([
  "Makefile", "makefile", "GNUmakefile", "justfile", "Justfile",
  "Dockerfile", "Gemfile", "Rakefile",
]);

// Extensions we count as "source LOC" for stats (excludes md/txt/json noise).
const CODE_EXT = new Set([
  ".js", ".cjs", ".mjs", ".jsx", ".ts", ".cts", ".mts", ".tsx",
  ".py", ".rb", ".go", ".rs", ".sh", ".bash", ".zsh", ".ps1",
]);

// ───────────────────────────────────────────────────────────────────────────
// Detector tables — keyed by threat primitive, easy to audit and extend.
// Each rule is a label + RegExp + severity (+ optional note). Patterns run
// per source line. `global` flag is added at registration for match counting.
// ───────────────────────────────────────────────────────────────────────────

interface Rule {
  label: string;
  category: string;
  re: RegExp;
  severity: Severity;
  note?: string;
}

function rule(
  label: string,
  category: string,
  source: string,
  severity: Severity,
  note?: string,
  flags = "g",
): Rule {
  return { label, category, re: new RegExp(source, flags), severity, note };
}

/**
 * Line-scan rules grouped by primitive. Primitive A (auto-execution) is handled
 * structurally from manifests, not here, but a couple of line-level A signals
 * (install shell scripts referenced inline) live under B/E where they surface.
 */
const LINE_RULES: Record<Exclude<Primitive, "A">, Rule[]> = {
  // B. DYNAMIC / INDIRECT EXECUTION
  B: [
    rule("js-eval", "dynamic-exec", String.raw`\beval\s*\(`, "high"),
    rule("js-new-function", "dynamic-exec", String.raw`\bnew\s+Function\s*\(`, "high"),
    rule("js-function-iife", "dynamic-exec", String.raw`\bFunction\s*\([^)]*\)\s*\(`, "high", "Function(...)() immediate-invoke"),
    rule("js-child-process", "dynamic-exec", String.raw`\b(require\(['"]child_process['"]\)|from\s+['"]child_process['"]|import\s+.*child_process)`, "medium"),
    rule("js-exec", "dynamic-exec", String.raw`\b(execSync|exec|spawnSync|spawn|execFile)\s*\(`, "medium"),
    rule("js-vm", "dynamic-exec", String.raw`\b(require\(['"]vm['"]\)|vm\.runIn[A-Za-z]+|process\.binding\s*\()`, "high"),
    rule("py-exec-eval", "dynamic-exec", String.raw`(?<![A-Za-z0-9_.])(exec|eval)\s*\(`, "high"),
    rule("py-os-system", "dynamic-exec", String.raw`\bos\.system\s*\(`, "high"),
    rule("py-subprocess", "dynamic-exec", String.raw`\bsubprocess\.(run|call|Popen|check_output|check_call)\s*\(`, "medium"),
    rule("py-pty-spawn", "dynamic-exec", String.raw`\bpty\.spawn\s*\(`, "high"),
    rule("py-dunder-import", "dynamic-exec", String.raw`\b__import__\s*\(`, "medium"),
    rule("py-compile", "dynamic-exec", String.raw`(?<![A-Za-z0-9_.])compile\s*\(`, "low"),
    rule("shell-pipe-to-sh", "dynamic-exec", String.raw`\|\s*(sudo\s+)?(ba)?sh\b`, "critical", "pipe to shell"),
    rule("curl-pipe-bash", "dynamic-exec", String.raw`\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba)?sh\b`, "critical", "remote-fetch piped to shell"),
  ],

  // C. EGRESS / C2 (network)
  C: [
    rule("js-fetch", "egress", String.raw`\bfetch\s*\(`, "low"),
    rule("js-axios", "egress", String.raw`\baxios\b`, "low"),
    rule("js-http-request", "egress", String.raw`\b(https?\.(request|get)|net\.connect|new\s+WebSocket|dgram\.|dns\.|XMLHttpRequest)\b`, "medium"),
    rule("py-net", "egress", String.raw`\b(requests\.|urllib|httpx\.|socket\.|http\.client)`, "medium"),
    rule("shell-net", "egress", String.raw`\b(curl|wget|nc|ncat|scp|telnet)\b`, "medium", "shellout network tool"),
    rule("url-literal", "egress", String.raw`\bhttps?:\/\/[^\s'"\`)]+`, "info", "hardcoded URL"),
    rule("ipv4-literal", "egress", String.raw`\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b`, "high", "hardcoded IPv4"),
    rule("exfil-sink", "egress", String.raw`(webhook\.site|pastebin\.com|paste\.ee|hastebin|discord(app)?\.com\/api\/webhooks|api\.telegram\.org\/bot|ngrok\.io|ngrok-free\.app|\.workers\.dev|requestbin|transfer\.sh|0x0\.st|termbin\.com)`, "high", "known exfil / C2 sink"),
  ],

  // D. SENSITIVE-RESOURCE ACCESS
  D: [
    rule("env-enumerate", "sensitive-access", String.raw`(Object\.keys\(\s*process\.env|\{\s*\.\.\.\s*process\.env|os\.environ\.copy\s*\(|dict\(\s*os\.environ)`, "high", "broad env harvesting"),
    rule("ssh-creds", "sensitive-access", String.raw`(~\/\.ssh|\bid_rsa\b|id_ed25519|authorized_keys|known_hosts)`, "high", "SSH credential path"),
    rule("aws-creds", "sensitive-access", String.raw`(~\/\.aws|\.aws\/credentials|AWS_SECRET_ACCESS_KEY)`, "high", "AWS credential path"),
    rule("misc-creds", "sensitive-access", String.raw`(\.npmrc|\.git-credentials|\.netrc|\.pypirc)`, "high", "credential file"),
    rule("cloud-config", "sensitive-access", String.raw`(~\/\.config\/gcloud|~\/\.kube\/config|\.kube\/config|~\/\.docker\/config\.json|\.docker\/config\.json)`, "high", "cloud/cluster config"),
    rule("keychain", "sensitive-access", String.raw`(security\s+find-generic-password|find-internet-password|keychain)`, "high", "macOS keychain access"),
    rule("browser-crypto-theft", "sensitive-access", String.raw`(Login\s?Data|Cookies(\.sqlite)?|wallet\.dat|keystore|MetaMask|Local\s?Storage|leveldb)`, "high", "browser/crypto wallet theft target"),
    rule("etc-passwd", "sensitive-access", String.raw`(\/etc\/passwd|\/etc\/shadow)`, "high", "system account file read"),
  ],

  // E. HOST MUTATION BEYOND SCOPE
  E: [
    rule("home-dotfiles", "host-mutation", String.raw`(~\/\.(bashrc|zshrc|profile|bash_profile|zprofile)|\.bashrc|\.zshrc|\.profile)`, "high", "home dotfile target"),
    rule("crontab", "host-mutation", String.raw`\bcrontab\b`, "high", "crontab mutation"),
    rule("launchd", "host-mutation", String.raw`(launchctl|LaunchAgents|LaunchDaemons|\.plist)`, "high", "launchd/launchagent persistence"),
    rule("systemd", "host-mutation", String.raw`(systemctl|\/etc\/systemd|\.service\b)`, "medium", "systemd persistence"),
    rule("etc-write", "host-mutation", String.raw`\/etc\/`, "medium", "writes/reads under /etc"),
    rule("authorized-keys-append", "host-mutation", String.raw`(>>\s*[^\n]*authorized_keys|authorized_keys[^\n]*>>)`, "critical", "append to authorized_keys"),
    rule("startup-folder", "host-mutation", String.raw`(Startup\\|\\Start Menu\\|Microsoft\\Windows\\Start)`, "medium", "Windows startup persistence"),
    rule("chmod-then-run", "host-mutation", String.raw`chmod\s+\+?x`, "low", "chmod +x (possible drop-and-run)"),
  ],

  // F. OBFUSCATION / EVASION
  F: [
    rule("base64-blob", "obfuscation", String.raw`[A-Za-z0-9+/]{120,}={0,2}`, "medium", "long base64 blob"),
    rule("base64-decode", "obfuscation", String.raw`(atob\s*\(|Buffer\.from\s*\([^)]*['"]base64['"]|base64\s+-d|base64\s+--decode|b64decode)`, "high", "base64 decode primitive"),
    rule("hex-blob", "obfuscation", String.raw`(0x[0-9a-fA-F]{2}[\s,]*){8,}`, "medium", "long hex array"),
    rule("hex-escape-run", "obfuscation", String.raw`(\\x[0-9a-fA-F]{2}){8,}`, "high", "\\xNN escape run"),
    rule("unicode-escape-run", "obfuscation", String.raw`(\\u00[0-9a-fA-F]{2}){8,}`, "high", "\\uXXXX escape run"),
    rule("fromcharcode", "obfuscation", String.raw`String\.fromCharCode\s*\(`, "medium", "fromCharCode decode chain"),
  ],

  // G handled mostly structurally; committed-secret line patterns live here.
  G: [
    rule("aws-akia", "committed-secret", String.raw`\bAKIA[0-9A-Z]{16}\b`, "critical", "AWS access key id"),
    rule("private-key-block", "committed-secret", String.raw`-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----`, "critical", "private key block"),
    rule("github-pat", "committed-secret", String.raw`\bghp_[A-Za-z0-9]{30,}\b`, "critical", "GitHub personal access token"),
    rule("slack-token", "committed-secret", String.raw`\bxox[baprs]-[A-Za-z0-9-]{10,}\b`, "critical", "Slack token"),
    rule("openai-key", "committed-secret", String.raw`\bsk-[A-Za-z0-9]{20,}\b`, "high", "OpenAI-style secret key"),
    rule("google-api-key", "committed-secret", String.raw`\bAIza[0-9A-Za-z_\-]{20,}\b`, "high", "Google API key"),
  ],
};

// Lifecycle script names that auto-run on install (primitive A core).
const LIFECYCLE_NAMES = new Set([
  "preinstall", "install", "postinstall",
  "preprepare", "prepare", "postprepare",
  "prepublish", "prepublishOnly", "prepack", "postpack",
  "preuninstall", "uninstall", "postuninstall",
]);

// Patterns inside a lifecycle script body that escalate its severity.
const LIFECYCLE_DANGER_RE = new RegExp(
  [
    String.raw`\bcurl\b`, String.raw`\bwget\b`,
    String.raw`\|\s*(ba)?sh\b`, String.raw`\bnode\s+-e\b`,
    String.raw`\beval\b`, String.raw`base64\s+-d`, String.raw`base64\s+--decode`,
    String.raw`\bpython[0-9]?\s+-c\b`, String.raw`\bsh\s+-c\b`, String.raw`\bbash\s+-c\b`,
    String.raw`>>\s*~?\/?\.[a-z]`, // appending to dotfiles
  ].join("|"),
);

// Files that, if present at repo root, are themselves auto-execution surface (A).
const ROOT_AUTOEXEC_FILES: Array<{ name: string; note: string }> = [
  { name: "setup.py", note: "python setup.py runs on install" },
  { name: "conftest.py", note: "pytest auto-imports conftest.py" },
  { name: "Makefile", note: "Make targets may fetch+run" },
  { name: "makefile", note: "Make targets may fetch+run" },
  { name: "justfile", note: "just recipes may fetch+run" },
  { name: "Justfile", note: "just recipes may fetch+run" },
];

// setup.py executable-statement signals (top-level side effects).
const SETUP_PY_DANGER_RE = new RegExp(
  [String.raw`os\.system\s*\(`, String.raw`subprocess\.`, String.raw`\beval\s*\(`, String.raw`\bexec\s*\(`, String.raw`urllib`, String.raw`requests\.`, String.raw`\bcheck_call\b`].join("|"),
);

// ───────────────────────────────────────────────────────────────────────────
// Small utilities
// ───────────────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5, high: 4, medium: 3, low: 2, info: 1,
};

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function truncate(s: string, max = SNIPPET_MAX): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

/** Redact a likely-secret value, preserving a tiny prefix for identification. */
function redact(s: string): string {
  const t = s.trim();
  if (t.length <= 8) return "[REDACTED]";
  return `${t.slice(0, 4)}…[REDACTED ${t.length} chars]`;
}

/** Decide if a buffer looks binary (NUL byte in the first chunk). */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function isSourceCandidate(name: string): boolean {
  if (SOURCE_FILENAMES.has(name)) return true;
  // .env, .env.local etc.: path.extname() returns "" for these dotfiles, so this
  // MUST be checked before the ext === "" early-return below or it becomes dead code.
  if (name === ".env" || name.startsWith(".env.")) return true;
  const ext = path.extname(name).toLowerCase();
  if (ext === "") {
    // Allow extensionless files only if they are known names handled above.
    return false;
  }
  return SOURCE_EXT.has(ext);
}

function isCodeFile(name: string): boolean {
  return CODE_EXT.has(path.extname(name).toLowerCase());
}

// ───────────────────────────────────────────────────────────────────────────
// Directory walk — manual, never follows symlinks out of root.
// ───────────────────────────────────────────────────────────────────────────

interface WalkedFile {
  abs: string;
  rel: string;
  size: number;
  inNoiseDir: boolean;
}

async function walk(root: string, includeDeps: boolean): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  const rootResolved = path.resolve(root);

  async function recurse(dir: string, inNoise: boolean): Promise<void> {
    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir — skip, never crash
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      let nextInNoise = inNoise;

      if (entry.isSymbolicLink()) {
        // Never follow symlinks out of the repo root; resolve and verify containment.
        let target: string;
        try {
          target = await fs.realpath(abs);
        } catch {
          continue; // dangling/unreadable symlink
        }
        const contained =
          target === rootResolved || target.startsWith(rootResolved + path.sep);
        if (!contained) continue; // points outside repo — skip entirely
        // Stat the resolved target to decide file vs dir, but do not chase loops:
        let st: Awaited<ReturnType<typeof fs.stat>>;
        try {
          st = await fs.stat(abs);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          // Treat contained symlinked dirs conservatively: skip to avoid loops.
          continue;
        }
        if (st.isFile()) {
          const rel = path.relative(rootResolved, abs);
          out.push({ abs, rel, size: st.size, inNoiseDir: inNoise });
        }
        continue;
      }

      if (entry.isDirectory()) {
        const isNoise = NOISE_DIRS.has(entry.name);
        if (isNoise && !(includeDeps && INCLUDE_DEPS_DIRS.has(entry.name))) {
          // Record presence but do not descend for line-scanning.
          // We still want to find workspace package.json under node_modules? No —
          // workspace manifests live in the author's tree, not node_modules.
          // .git is never descended regardless of flags.
          if (entry.name === ".git") continue;
          if (!includeDeps) {
            // Mark that this noise dir exists by emitting a zero-size sentinel
            // so ecosystem-presence logic can see it, but skip its contents.
            out.push({
              abs,
              rel: path.relative(rootResolved, abs),
              size: 0,
              inNoiseDir: true,
            });
            continue;
          }
          nextInNoise = true;
        } else if (isNoise) {
          nextInNoise = true;
        }
        await recurse(abs, nextInNoise);
        continue;
      }

      if (entry.isFile()) {
        let size = 0;
        try {
          const st = await fs.stat(abs);
          size = st.size;
        } catch {
          continue;
        }
        out.push({
          abs,
          rel: path.relative(rootResolved, abs),
          size,
          inNoiseDir: inNoise,
        });
      }
      // sockets/fifos/etc. ignored.
    }
  }

  await recurse(rootResolved, false);
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// File reading — text only, size-capped, binary-skipping.
// ───────────────────────────────────────────────────────────────────────────

interface ReadOutcome {
  ok: boolean;
  text?: string;
  reason?: "too-large" | "binary" | "unreadable";
}

async function readTextCapped(abs: string, size: number): Promise<ReadOutcome> {
  if (size > MAX_LINE_SCAN_BYTES) return { ok: false, reason: "too-large" };
  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (looksBinary(buf)) return { ok: false, reason: "binary" };
  return { ok: true, text: buf.toString("utf8") };
}

// ───────────────────────────────────────────────────────────────────────────
// Line-level scanning
// ───────────────────────────────────────────────────────────────────────────

function scanText(rel: string, text: string, findings: Finding[]): void {
  const lines = text.split(/\r?\n/);
  // Minified-as-source heuristic (F): a very long single line in a non-noise
  // source file. We already excluded noise dirs before calling scanText.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > MINIFIED_LINE_THRESHOLD && isCodeFileRel(rel)) {
      findings.push({
        primitive: "F",
        category: "obfuscation",
        severity: "medium",
        file: rel,
        line: i + 1,
        snippet: truncate(line),
        note: `minified-looking source line (${line.length} chars) shipped outside dist/build`,
      });
    }
  }

  for (const primitive of Object.keys(LINE_RULES) as Array<Exclude<Primitive, "A">>) {
    for (const r of LINE_RULES[primitive]) {
      let perFileCount = 0;
      for (let i = 0; i < lines.length && perFileCount < MAX_FINDINGS_PER_RULE_PER_FILE; i++) {
        const line = lines[i];
        r.re.lastIndex = 0;
        let m: RegExpExecArray | null;
        // Use exec loop to capture the matched snippet location.
        while ((m = r.re.exec(line)) !== null) {
          const matched = m[0] ?? line;
          const isSecret = primitive === "G";
          findings.push({
            primitive,
            category: r.category,
            severity: r.severity,
            file: rel,
            line: i + 1,
            snippet: isSecret ? redactInSnippet(line, matched) : truncate(line),
            note: r.note,
          });
          perFileCount++;
          if (m.index === r.re.lastIndex) r.re.lastIndex++; // avoid zero-width loop
          if (perFileCount >= MAX_FINDINGS_PER_RULE_PER_FILE) break;
        }
      }
    }
  }
}

function isCodeFileRel(rel: string): boolean {
  return CODE_EXT.has(path.extname(rel).toLowerCase());
}

/** Build a redacted one-line snippet that masks the matched secret value. */
function redactInSnippet(line: string, matched: string): string {
  const safe = line.replace(matched, redact(matched));
  return truncate(safe);
}

// ───────────────────────────────────────────────────────────────────────────
// Manifest parsing (primitives A and G)
// ───────────────────────────────────────────────────────────────────────────

interface PackageJson {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecordOfString(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string") out[k] = val;
    }
  }
  return out;
}

function lifecycleSeverity(body: string): Severity {
  return LIFECYCLE_DANGER_RE.test(body) ? "critical" : "high";
}

/** Parse one package.json: extract lifecycle scripts (A) and deps (G). */
function parsePackageJson(
  rel: string,
  text: string,
  lifecycle: LifecycleScript[],
  deps: DependencyReport,
): void {
  const parsed = safeParseJson(text) as PackageJson | null;
  if (!parsed || typeof parsed !== "object") return;

  const scripts = asRecordOfString(parsed.scripts);
  for (const [name, body] of Object.entries(scripts)) {
    if (LIFECYCLE_NAMES.has(name)) {
      lifecycle.push({
        name,
        body: truncate(body, 400),
        severity: lifecycleSeverity(body),
        file: rel,
      });
    }
  }

  const depBuckets = [
    parsed.dependencies,
    parsed.devDependencies,
    parsed.optionalDependencies,
    parsed.peerDependencies,
  ];
  for (const bucket of depBuckets) {
    const entries = asRecordOfString(bucket);
    for (const [pkg, spec] of Object.entries(entries)) {
      deps.count++;
      const s = spec.trim();
      if (/^(git\+|https?:\/\/|github:|gitlab:|bitbucket:|git:)/.test(s)) {
        deps.urlOrGit.push(`${pkg}@${s}`);
      } else if (s.startsWith("file:") || s.startsWith("link:")) {
        deps.file.push(`${pkg}@${s}`);
      } else if (s === "*" || s === "" || s === "latest" || /^[\^~]?x/i.test(s) || /^>=?\s*0/.test(s)) {
        deps.unpinned++;
      } else if (/^[\^~]/.test(s)) {
        deps.unpinned++; // caret/tilde ranges are not pinned
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Ecosystem detection
// ───────────────────────────────────────────────────────────────────────────

const LOCKFILE_NAMES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  "Cargo.lock", "go.sum", "Gemfile.lock", "poetry.lock", "Pipfile.lock",
]);

function ecosystemForFile(name: string): string | null {
  switch (name) {
    case "package.json": return "node";
    case "requirements.txt":
    case "pyproject.toml":
    case "setup.py":
    case "Pipfile": return "python";
    case "go.mod": return "go";
    case "Cargo.toml": return "rust";
    case "Gemfile": return "ruby";
    default: return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// requirements.txt / pyproject / go.mod / Cargo.toml / Gemfile heuristics (G)
// ───────────────────────────────────────────────────────────────────────────

function scanRequirementsTxt(rel: string, text: string, findings: Finding[]): void {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^(-e\s+|git\+)/.test(line) || /git\+https?:/.test(line)) {
      findings.push({
        primitive: "G", category: "inherited-trust", severity: "medium",
        file: rel, line: i + 1, snippet: truncate(line),
        note: "editable / VCS python dependency",
      });
    } else if (!/[=<>!~]=|==/.test(line) && /^[A-Za-z0-9._-]+/.test(line)) {
      findings.push({
        primitive: "G", category: "inherited-trust", severity: "low",
        file: rel, line: i + 1, snippet: truncate(line),
        note: "unpinned python dependency (no version constraint)",
      });
    }
  }
}

function scanGoMod(rel: string, text: string, findings: Finding[]): void {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*replace\s+/.test(lines[i])) {
      findings.push({
        primitive: "G", category: "inherited-trust", severity: "medium",
        file: rel, line: i + 1, snippet: truncate(lines[i]),
        note: "go.mod replace directive (dependency redirection)",
      });
    }
  }
}

function scanCargoToml(rel: string, text: string, findings: Finding[]): void {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/\b(git|path)\s*=/.test(lines[i]) && /=/.test(lines[i])) {
      if (/\bgit\s*=/.test(lines[i])) {
        findings.push({
          primitive: "G", category: "inherited-trust", severity: "medium",
          file: rel, line: i + 1, snippet: truncate(lines[i]),
          note: "Cargo git dependency",
        });
      }
    }
  }
}

function scanGemfile(rel: string, text: string, findings: Finding[]): void {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/\bgit:|\bgithub:|:git\s*=>/.test(lines[i])) {
      findings.push({
        primitive: "G", category: "inherited-trust", severity: "medium",
        file: rel, line: i + 1, snippet: truncate(lines[i]),
        note: "Gemfile git dependency",
      });
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Online (opt-in) dependency vulnerability check — the ONLY subprocess.
// ───────────────────────────────────────────────────────────────────────────

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("command", ["-v", cmd], { shell: true, stdio: "ignore" });
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
  });
}

interface SubprocResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runCapped(cmd: string, args: string[], timeoutMs: number): Promise<SubprocResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve({ ok: false, stdout: "", stderr: "spawn failed", timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 2000);
    }, timeoutMs);

    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: stderr || "exec error", timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 || stdout.length > 0, stdout, stderr, timedOut });
    });
  });
}

async function runOnline(repoAbs: string, lockfiles: string[]): Promise<OnlineReport> {
  const report: OnlineReport = { ran: false, tool: null, advisories: [] };

  // Prefer osv-scanner (works across ecosystems, reads manifests/lockfiles).
  if (await commandExists("osv-scanner")) {
    try {
      const res = await runCapped("osv-scanner", ["--format", "json", "-r", repoAbs], ONLINE_TIMEOUT_MS);
      report.ran = true;
      report.tool = "osv-scanner";
      if (res.timedOut) {
        report.note = "osv-scanner timed out (advisory only)";
        return report;
      }
      const parsed = safeParseJson(res.stdout);
      report.advisories = parsed ? [parsed] : [];
      report.note = "advisory only — heuristic, not authoritative";
      return report;
    } catch {
      report.note = "osv-scanner failed (advisory only)";
      report.ran = true;
      report.tool = "osv-scanner";
      return report;
    }
  }

  // Fall back to npm audit ONLY if an npm lockfile exists.
  const hasNpmLock = lockfiles.includes("package-lock.json") || lockfiles.includes("npm-shrinkwrap.json");
  if (hasNpmLock && (await commandExists("npm"))) {
    try {
      // npm audit reads the lockfile; --package-lock-only avoids any install.
      const res = await runCapped(
        "npm",
        ["audit", "--json", "--package-lock-only", "--prefix", repoAbs],
        ONLINE_TIMEOUT_MS,
      );
      report.ran = true;
      report.tool = "npm audit";
      if (res.timedOut) {
        report.note = "npm audit timed out (advisory only)";
        return report;
      }
      const parsed = safeParseJson(res.stdout);
      report.advisories = parsed ? [parsed] : [];
      report.note = "advisory only — heuristic, not authoritative";
      return report;
    } catch {
      report.note = "npm audit failed (advisory only)";
      report.ran = true;
      report.tool = "npm audit";
      return report;
    }
  }

  report.note = "no supported online tool available (osv-scanner / npm audit)";
  return report;
}

// ───────────────────────────────────────────────────────────────────────────
// Core scan
// ───────────────────────────────────────────────────────────────────────────

async function scanRepo(repoArg: string, opts: Options): Promise<ScanResult> {
  const repoAbs = path.resolve(repoArg);

  const findings: Finding[] = [];
  const lifecycle: LifecycleScript[] = [];
  const secrets: SecretFinding[] = [];
  const deps: DependencyReport = { count: 0, unpinned: 0, urlOrGit: [], file: [] };
  const ecosystems = new Set<string>();
  const lockfiles = new Set<string>();
  const noiseDirsPresent = new Set<string>();

  const stats: ScanStats = { filesScanned: 0, filesSkipped: 0, bytesScanned: 0 };
  const largest: Array<{ file: string; bytes: number }> = [];

  const files = await walk(repoAbs, opts.includeDeps);

  for (const f of files) {
    const base = path.basename(f.rel);

    // Sentinel entries (skipped noise dirs) are zero-size dirs we recorded for presence.
    if (f.inNoiseDir && f.size === 0 && NOISE_DIRS.has(base)) {
      noiseDirsPresent.add(base);
      continue;
    }

    // Ecosystem + lockfile presence detection regardless of scan scope.
    const eco = ecosystemForFile(base);
    if (eco) ecosystems.add(eco);
    if (LOCKFILE_NAMES.has(base)) lockfiles.add(base);

    // Track largest files (top 5) for stats.
    largest.push({ file: f.rel, bytes: f.size });

    // ── Primitive A & G: parse manifests no matter where they live (root + workspaces),
    //    but cap workspace depth to keep it fast. Skip manifests buried in node_modules
    //    unless --include-deps (those are dependency internals, not the author's tree).
    const depth = f.rel.split(path.sep).length - 1;
    const inDepsDir = /(^|[\\/])(node_modules|vendor)([\\/]|$)/.test(f.rel);
    const wantManifest =
      depth <= MAX_WORKSPACE_DEPTH && (!inDepsDir || opts.includeDeps);

    if (base === "package.json" && wantManifest && f.size <= MAX_LINE_SCAN_BYTES) {
      const r = await readTextCapped(f.abs, f.size);
      if (r.ok && r.text) {
        parsePackageJson(f.rel, r.text, lifecycle, deps);
        stats.bytesScanned += f.size;
        stats.filesScanned++;
      } else {
        stats.filesSkipped++;
      }
      // package.json is also a normal text file; continue to generic scanning below
      // only if not in a deps dir we are otherwise skipping.
    }

    // Root auto-execution surface files (A).
    if (depth === 0) {
      const auto = ROOT_AUTOEXEC_FILES.find((a) => a.name === base);
      if (auto) {
        findings.push({
          primitive: "A",
          category: "auto-exec-surface",
          severity: base === "setup.py" || base === "conftest.py" ? "high" : "medium",
          file: f.rel,
          line: 1,
          snippet: truncate(`${base} present at repo root`),
          note: auto.note,
        });
      }
    }

    // Ecosystem-specific manifest heuristics (G) at any allowed depth.
    if (wantManifest && f.size <= MAX_LINE_SCAN_BYTES) {
      if (base === "requirements.txt" || base === "Pipfile") {
        const r = await readTextCapped(f.abs, f.size);
        if (r.ok && r.text) scanRequirementsTxt(f.rel, r.text, findings);
      } else if (base === "go.mod") {
        const r = await readTextCapped(f.abs, f.size);
        if (r.ok && r.text) scanGoMod(f.rel, r.text, findings);
      } else if (base === "Cargo.toml") {
        const r = await readTextCapped(f.abs, f.size);
        if (r.ok && r.text) scanCargoToml(f.rel, r.text, findings);
      } else if (base === "Gemfile") {
        const r = await readTextCapped(f.abs, f.size);
        if (r.ok && r.text) scanGemfile(f.rel, r.text, findings);
      } else if (base === "setup.py") {
        const r = await readTextCapped(f.abs, f.size);
        if (r.ok && r.text && SETUP_PY_DANGER_RE.test(r.text)) {
          findings.push({
            primitive: "A", category: "auto-exec-surface", severity: "high",
            file: f.rel, line: 1, snippet: truncate("setup.py contains executable side-effects"),
            note: "setup.py runs os.system/subprocess/eval/network at install time",
          });
        }
      }
    }

    // ── Generic line-level scanning (B–G line rules + F minified) ──
    // Skip contents of noise dirs unless --include-deps re-enabled them in walk().
    if (f.inNoiseDir && !opts.includeDeps) {
      stats.filesSkipped++;
      continue;
    }

    if (!isSourceCandidate(base)) {
      stats.filesSkipped++;
      continue;
    }

    // .env / .env.* presence => committed-secret signal (report presence, never values).
    if (base === ".env" || base.startsWith(".env.")) {
      secrets.push({
        file: f.rel, line: 1, kind: "env-file",
        note: "environment file present (values redacted / not printed)",
      });
      // Still scan for explicit key patterns inside, but values are redacted by G rules.
    }

    if (f.size > MAX_LINE_SCAN_BYTES) {
      // Too large to line-scan, but note it as a skipped large file.
      stats.filesSkipped++;
      continue;
    }

    const read = await readTextCapped(f.abs, f.size);
    if (!read.ok || read.text === undefined) {
      stats.filesSkipped++;
      continue;
    }

    const before = findings.length;
    scanText(f.rel, read.text, findings);

    // Promote any G committed-secret findings into the secrets[] list too.
    for (let k = before; k < findings.length; k++) {
      const fd = findings[k];
      if (fd.primitive === "G" && fd.category === "committed-secret") {
        secrets.push({
          file: fd.file, line: fd.line, kind: fd.note ?? "secret",
          note: "committed secret pattern (value redacted)",
        });
      }
    }

    stats.filesScanned++;
    stats.bytesScanned += f.size;
  }

  // Largest files: top 5 by size.
  largest.sort((a, b) => b.bytes - a.bytes);
  const largestFiles = largest.slice(0, 5);

  // Optional online dependency check.
  let online: OnlineReport = { ran: false, tool: null, advisories: [] };
  if (opts.online) {
    online = await runOnline(repoAbs, [...lockfiles]);
  } else {
    online.note = "offline (pass --online to run advisory dependency check)";
  }

  // Summary tallies.
  const byPrimitive: Record<Primitive, number> = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
  const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0, byPrimitive };
  for (const fd of findings) {
    summary[fd.severity]++;
    byPrimitive[fd.primitive]++;
  }
  for (const ls of lifecycle) {
    summary[ls.severity]++;
    byPrimitive.A++;
  }

  // Ordering: findings sorted by primitive (A→G) then severity (critical→info) then file.
  findings.sort((a, b) => {
    if (a.primitive !== b.primitive) return a.primitive.localeCompare(b.primitive);
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
      return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    }
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  return {
    repo: repoAbs,
    scannedAt: new Date().toISOString(),
    ecosystems: [...ecosystems].sort(),
    stats,
    lockfiles: [...lockfiles].sort(),
    dependencies: deps,
    lifecycleScripts: lifecycle,
    findings,
    secrets,
    largestFiles,
    summary,
    online,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Output — human-readable
// ───────────────────────────────────────────────────────────────────────────

const PRIMITIVE_TITLES: Record<Primitive, string> = {
  A: "A. AUTOMATIC-EXECUTION SURFACE",
  B: "B. DYNAMIC / INDIRECT EXECUTION",
  C: "C. EGRESS / C2 (network)",
  D: "D. SENSITIVE-RESOURCE ACCESS",
  E: "E. HOST MUTATION BEYOND SCOPE",
  F: "F. OBFUSCATION / EVASION",
  G: "G. INHERITED TRUST (deps + committed secrets)",
};

const SEV_LABEL: Record<Severity, string> = {
  critical: "CRIT", high: "HIGH", medium: "MED ", low: "LOW ", info: "INFO",
};

function printHuman(r: ScanResult): void {
  const L: string[] = [];
  L.push("══════════════════════════════════════════════════════════════");
  L.push(" VetRepo static safety scan  (heuristic signal — NOT a verdict)");
  L.push("══════════════════════════════════════════════════════════════");
  L.push(` repo:        ${r.repo}`);
  L.push(` scannedAt:   ${r.scannedAt}`);
  L.push(` ecosystems:  ${r.ecosystems.length ? r.ecosystems.join(", ") : "(none detected)"}`);
  L.push(` lockfiles:   ${r.lockfiles.length ? r.lockfiles.join(", ") : "(none)"}`);
  L.push(
    ` files:       scanned ${r.stats.filesScanned}, skipped ${r.stats.filesSkipped}, bytes ${r.stats.bytesScanned}`,
  );
  L.push(
    ` deps:        count ${r.dependencies.count}, unpinned ${r.dependencies.unpinned}, ` +
      `url/git ${r.dependencies.urlOrGit.length}, file ${r.dependencies.file.length}`,
  );

  // Loudest section first: anything that auto-runs on install.
  if (r.lifecycleScripts.length > 0) {
    L.push("");
    L.push("⚠ AUTOMATIC EXECUTION (runs before you ever read the code):");
    for (const ls of r.lifecycleScripts) {
      L.push(`  [${SEV_LABEL[ls.severity]}] ${ls.file}  npm script "${ls.name}"  ›  ${ls.body}`);
    }
  }

  // Findings grouped by primitive A–G, skipping empty sections.
  for (const p of ["A", "B", "C", "D", "E", "F", "G"] as Primitive[]) {
    const group = r.findings.filter((f) => f.primitive === p);
    if (group.length === 0) continue;
    L.push("");
    L.push(`${PRIMITIVE_TITLES[p]}  (${group.length})`);
    for (const f of group) {
      const note = f.note ? `  ${f.note}` : "";
      L.push(`  [${SEV_LABEL[f.severity]}] ${f.file}:${f.line}${note}  ›  ${f.snippet}`);
    }
  }

  if (r.secrets.length > 0) {
    L.push("");
    L.push(`COMMITTED-SECRET SIGNALS  (${r.secrets.length})  — values redacted`);
    for (const s of r.secrets) {
      L.push(`  [${SEV_LABEL["high"]}] ${s.file}:${s.line}  ${s.kind}  ›  ${s.note}`);
    }
  }

  if (r.online.ran) {
    L.push("");
    L.push(`ONLINE DEPENDENCY CHECK (advisory): tool=${r.online.tool}  advisories=${r.online.advisories.length}`);
    if (r.online.note) L.push(`  note: ${r.online.note}`);
  }

  // Tally line + reminder.
  const s = r.summary;
  L.push("");
  L.push(
    `TALLY: critical ${s.critical} · high ${s.high} · medium ${s.medium} · low ${s.low} · info ${s.info}` +
      `   [A:${s.byPrimitive.A} B:${s.byPrimitive.B} C:${s.byPrimitive.C} D:${s.byPrimitive.D} E:${s.byPrimitive.E} F:${s.byPrimitive.F} G:${s.byPrimitive.G}]`,
  );
  L.push("This is heuristic static signal, not proof. A clean scan is not a guarantee; review findings in context before adopting the repo.");

  process.stdout.write(L.join("\n") + "\n");
}

// ───────────────────────────────────────────────────────────────────────────
// CLI
// ───────────────────────────────────────────────────────────────────────────

const USAGE = `VetRepo Scan — STATIC safety scanner for an untrusted cloned repo.

USAGE
  bun run Scan.ts <repo-path> [flags]

FLAGS
  --json           Emit a single JSON object (no human text). Parseable by jq.
  --online         ALSO run an advisory dependency-vuln check via subprocess
                   (osv-scanner, else npm audit if an npm lockfile exists).
                   This is the ONLY subprocess and the ONLY network access.
  --include-deps   Also pattern-scan node_modules / vendor / dist (off by default).
  --help           Show this help.

SAFETY
  STATIC ANALYSIS ONLY. This tool never executes, imports, builds, installs, or
  runs any code or scripts from the target repo — it reads files as text. Offline
  by default. Symlinks are never followed outside the repo root.

EXIT CODES
  0  successful scan (regardless of findings)
  1  usage error (missing/invalid path or unknown flag)
`;

interface ParsedArgs {
  repoPath: string | null;
  opts: Options;
  help: boolean;
  error: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const opts: Options = { json: false, online: false, includeDeps: false };
  let repoPath: string | null = null;
  let help = false;
  let error: string | null = null;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--online") {
      opts.online = true;
    } else if (arg === "--include-deps") {
      opts.includeDeps = true;
    } else if (arg.startsWith("-")) {
      error = `unknown flag: ${arg}`;
    } else if (repoPath === null) {
      repoPath = arg;
    } else {
      error = `unexpected extra argument: ${arg}`;
    }
  }

  return { repoPath, opts, help, error };
}

async function main(): Promise<number> {
  const { repoPath, opts, help, error } = parseArgs(process.argv.slice(2));

  if (help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (error) {
    process.stderr.write(`error: ${error}\n\n${USAGE}`);
    return 1;
  }
  if (!repoPath) {
    process.stderr.write(`error: missing <repo-path>\n\n${USAGE}`);
    return 1;
  }

  // Validate the path exists and is a directory — usage error otherwise.
  let stat;
  try {
    stat = await fs.stat(repoPath);
  } catch {
    process.stderr.write(`error: path does not exist: ${repoPath}\n`);
    return 1;
  }
  if (!stat.isDirectory()) {
    process.stderr.write(`error: path is not a directory: ${repoPath}\n`);
    return 1;
  }

  const result = await scanRepo(repoPath, opts);

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printHuman(result);
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    // Defense-in-depth: a successful scan must never crash. If something truly
    // unexpected escapes, fail as a usage-level error with context rather than
    // a raw stack, so callers get a clean signal.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fatal: unexpected scanner error: ${msg}\n`);
    process.exitCode = 1;
  });
