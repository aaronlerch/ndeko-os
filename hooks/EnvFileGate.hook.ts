#!/usr/bin/env bun
/**
 * EnvFileGate.hook.ts — PreToolUse on Read | Write | Edit | MultiEdit | NotebookEdit | Bash
 *
 * WHY THIS EXISTS
 *
 * `permissions.deny` used to carry `Read(//**\/.env.*)`, which blocked the whole
 * dotenv family — including `.env.example`, which is a committed template with no
 * secrets in it and which every repo expects to be readable and editable.
 *
 * There is no way to write that exception in settings.json. Two facts from the
 * permissions reference make this a closed door, both verified 2026-09-04:
 *
 *   - "a deny rule can't carry allowlist exceptions" — deny is evaluated before
 *     ask and allow, and specificity does not reorder it.
 *   - "Hook decisions don't bypass permission rules ... a matching deny rule
 *     blocks the call" even when a PreToolUse hook returns "allow".
 *
 * So a hook cannot open a hole in a deny rule. It CAN close one: a hook that
 * exits 2 blocks the call outright. That asymmetry dictates the design.
 *
 * THE TWO LAYERS
 *
 * Layer 1 lives in settings.json: an enumerated deny for the dotenv names that
 * are never templates (`.env`, `.env.local`, `.env.production`, `.env.keys`, …).
 * Those are unconditional and also cover Bash's recognized file commands.
 *
 * Layer 2 is this hook. It denies everything else in the dotenv family unless
 * BOTH of two independent signals agree that the file is a template:
 *
 *   1. the basename is template-shaped (`.env.example` and friends), and
 *   2. git does not consider the path ignored.
 *
 * Requiring both means a novel secret-bearing name — `.env.backup`,
 * `.env.myapp-creds`, whatever dotenv invents next — is denied by default rather
 * than passing because nobody thought to enumerate it. The layers also cover each
 * other: layer 1 still blocks a `.env.production` that someone committed by
 * mistake, where the git signal alone would wave it through.
 *
 * The git check only runs inside a repository. Outside one there is no signal to
 * read, and failing closed there would block ordinary work in unpacked tarballs
 * and scratch directories while adding nothing — the name check is already doing
 * the work in that case.
 *
 * SCOPE
 *
 * This is a tripwire on the paths Claude's own tools touch. It does not and
 * cannot stop a subprocess that opens files itself; that is what the sandbox is
 * for. Read and Edit deny rules have the same limit.
 */

import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { block, readHookInput } from "./lib/hook-io.ts";

/** Tools whose file argument is a single path. */
const PATH_KEYS = ["file_path", "notebook_path"] as const;

/** True for `.env` and anything in the `.env.<suffix>` family. */
export function isEnvFamily(path: string): boolean {
  return /^\.env(\..+)?$/.test(basename(path));
}

/**
 * Suffixes that mean "this file is a checked-in template". Deliberately a short
 * list of real conventions rather than a guess at every possibility — this is
 * the allowing half of the gate, so a name that is not clearly a template should
 * fall through to the deny.
 *
 * `.env.example`, and also the `.env.<env>.example` form some projects use.
 */
const TEMPLATE_SUFFIX = /\.(example|sample|template|defaults|dist|schema|tpl|tmpl)$/i;

export function isTemplateName(path: string): boolean {
  const name = basename(path);
  return isEnvFamily(name) && TEMPLATE_SUFFIX.test(name);
}

/**
 * Ask git whether it ignores this path. Returns null when the question has no
 * answer — not a repository, or git is unavailable — which the caller reads as
 * "no signal" rather than as a verdict.
 *
 * `check-ignore` answers for paths that do not exist yet, which is what makes it
 * usable on a Write that is creating the file.
 */
export function gitIgnores(absPath: string): boolean | null {
  try {
    const r = spawnSync("git", ["-C", dirname(absPath), "check-ignore", "-q", "--", absPath], {
      stdio: "ignore",
      timeout: 3000,
    });
    if (r.status === 0) return true;
    if (r.status === 1) return false;
    return null; // 128 = not a repository; anything else is equally uninformative.
  } catch {
    return null;
  }
}

export type Verdict = { allowed: true } | { allowed: false; reason: string };

/** The whole decision, pure apart from the git call, so the tests can drive it. */
export function judge(absPath: string, ignores: (p: string) => boolean | null = gitIgnores): Verdict {
  if (!isEnvFamily(absPath)) return { allowed: true };

  if (!isTemplateName(absPath)) {
    return {
      allowed: false,
      reason:
        `"${basename(absPath)}" is in the dotenv family but is not a template name. ` +
        `Template suffixes: example, sample, template, defaults, dist, schema, tpl, tmpl.`,
    };
  }

  if (ignores(absPath) === true) {
    return {
      allowed: false,
      reason:
        `"${basename(absPath)}" is template-named but git ignores it, which means it holds ` +
        `real values rather than placeholders. A committed template is not gitignored.`,
    };
  }

  return { allowed: true };
}

/**
 * Pull dotenv-family paths out of a shell command. Tokenizes on whitespace and
 * the shell metacharacters that end an argument, then strips quotes and any
 * `--flag=` prefix.
 *
 * Layer 1's settings deny already covers Bash for the enumerated names — this
 * arm exists for the residual, so it aims for coverage of ordinary commands and
 * does not try to be a shell parser.
 *
 * Two kinds of prose are removed before tokenizing, both found by this hook
 * blocking its own authoring on 2026-09-04:
 *
 *   - Heredoc bodies, which are inert data for a data-consuming command. The
 *     first live call blocked a `cat >> file <<'EOF'` whose body merely
 *     *described* the deny rule it was replacing.
 *   - Commit-message bodies. The second block was `git commit -m "..."` where the
 *     message explained the change. A `-m` argument is never a path.
 *
 * Trailing punctuation is stripped for the same reason: the token that tripped
 * the second block was `.env.example,` — a filename in a sentence, not an
 * argument. A glob written as a real argument still counts, since `cat .env.*`
 * is a leak.
 */
const MESSAGE_ARG = /(^|\s)(-{1,2}(?:m|message|am|cm)\b)\s*("(?:[^"\\]|\\.)*"|'[^']*')/g;

/**
 * Remove every heredoc body, including one piped into an interpreter.
 *
 * This deliberately differs from `catastrophic-shapes.stripHeredocBodies`, which
 * keeps executed bodies because a `bash <<EOF` body is exactly the code it hunts
 * for. The threat models diverge: a `.env` read performed *inside* a python or
 * node heredoc is a subprocess opening a file itself, which no permission rule
 * reaches either — the docs are explicit that Read and Edit rules "don't apply to
 * arbitrary subprocesses that read or write files indirectly". Scanning those
 * bodies would buy inconsistent partial coverage at the price of firing on prose,
 * which is how this hook blocked its own test file being written. Enforcement
 * inside a subprocess is the sandbox's job.
 */
export function stripAllHeredocBodies(cmd: string): string {
  let out = cmd;
  for (const m of cmd.matchAll(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g)) {
    if (m.index === undefined) continue;
    const tag = m[2];
    if (!tag) continue;

    const bodyStart = cmd.indexOf("\n", m.index + m[0].length);
    if (bodyStart === -1) continue;

    const rest = cmd.slice(bodyStart + 1);
    const term = rest.match(new RegExp(`^\\s*${tag}\\s*$`, "m"));
    const body = term && term.index !== undefined ? rest.slice(0, term.index) : rest;

    if (body.trim() !== "") out = out.split(body).join("\n");
  }
  return out;
}

export function envPathsInCommand(command: string): string[] {
  const cleaned = stripAllHeredocBodies(command).replace(MESSAGE_ARG, '$1$2 ""');
  const out: string[] = [];
  for (const raw of cleaned.split(/[\s;|&<>()]+/)) {
    const tok = raw
      .replace(/^["']+|["']+$/g, "")
      .replace(/^--?[A-Za-z0-9-]+=/, "")
      .replace(/[,.;:!?)\]}]+$/, "");
    if (tok && isEnvFamily(tok)) out.push(tok);
  }
  return out;
}

/** Every path this tool call would touch, absolute. */
export function targets(toolName: string, input: Record<string, unknown>, cwd: string): string[] {
  const found: string[] = [];

  for (const key of PATH_KEYS) {
    const v = input[key];
    if (typeof v === "string") found.push(v);
  }
  if (toolName === "Bash" && typeof input.command === "string") {
    found.push(...envPathsInCommand(input.command));
  }

  return found.map((p) => (isAbsolute(p) ? p : resolve(cwd, p)));
}

async function main(): Promise<void> {
  const input = await readHookInput();
  if (!input?.tool_input) process.exit(0);

  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const paths = targets(input.tool_name ?? "", input.tool_input, cwd).filter(isEnvFamily);
  if (!paths.length) process.exit(0);

  for (const p of paths) {
    const verdict = judge(p);
    if (!verdict.allowed) {
      block(
        `EnvFileGate: blocked access to a dotenv file.\n\n` +
          `  path: ${p}\n  ${verdict.reason}\n\n` +
          `Committed templates (.env.example and friends) are allowed. Files holding real ` +
          `values are not, and no stated intent clears that. If this name is genuinely a ` +
          `template convention this gate does not know, add its suffix to TEMPLATE_SUFFIX in ` +
          `~/.claude/hooks/EnvFileGate.hook.ts.`,
      );
    }
  }

  process.exit(0);
}

if (import.meta.main) await main();
