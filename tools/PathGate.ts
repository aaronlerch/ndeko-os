#!/usr/bin/env bun
/**
 * PathGate.ts — the build gate that keeps path resolution honest.
 *
 * INVARIANT: `hooks/lib/paths.ts` is the only file allowed to contain a
 * config-root path literal. Everywhere else, a hardcoded `~/.claude` or
 * `~/.ndeko-os` is a latent bug that fails SILENTLY — under a renamed root it
 * keeps resolving to the old tree and writes there with no error. The
 * predecessor had ~25 such literals across 11 files, and one hook wrote to two
 * trees simultaneously because of it.
 *
 * WHY THIS IS A SCRIPT AND NOT A GREP
 *
 * A naive `rg '\.claude'` flags comments, doc URLs, test names, and regexes that
 * match user *prose* about local paths — all harmless. A gate with a high false
 * positive rate is a gate people route around, so this one strips comments and
 * only reports literals that appear where a path is actually being built.
 *
 * A genuinely-needed exception gets an explicit `path-gate-allow` pragma on the
 * line, which keeps it auditable rather than invisible.
 *
 * Usage:  bun tools/PathGate.ts          # report, exit 1 on violation
 *         bun tools/PathGate.ts --list   # show allowed exceptions too
 */

import { Glob } from "bun";
import { harnessRoot } from "../hooks/lib/paths.ts";

/** The file that owns path resolution. Literals are correct here. */
const AUTHORITY = "hooks/lib/paths.ts";

/**
 * Config-root shapes that must not be hardcoded elsewhere.
 * `\.ndeko-[\w-]+` matches the current root name and any future one: a literal
 * left behind by a rename is exactly the silent bug this gate exists to catch,
 * so the pattern has to outlive whatever the tree is called today.
 */
const LITERALS = /(\.claude|\.ndeko-[\w-]+|\.config\/ndeko)/;

/**
 * Path-construction context. A literal only matters if it is being turned into
 * a path — joined, resolved, opened, or interpolated into one.
 */
const PATH_CONTEXT = /\b(join|resolve|readFileSync|writeFileSync|existsSync|mkdirSync|appendFileSync|readdirSync|Bun\.file|import\s*\()\s*\(|`[^`]*\$\{/;

const PRAGMA = "path-gate-allow";

interface Finding {
  file: string;
  line: number;
  text: string;
  allowed: boolean;
}

/** Remove comment content so prose never trips the gate. Crude but sufficient. */
function stripComments(src: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of src.split("\n")) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) {
        out.push("");
        continue;
      }
      line = line.slice(end + 2);
      inBlock = false;
    }
    const blockStart = line.indexOf("/*");
    if (blockStart !== -1) {
      const end = line.indexOf("*/", blockStart + 2);
      if (end === -1) {
        line = line.slice(0, blockStart);
        inBlock = true;
      } else {
        line = line.slice(0, blockStart) + line.slice(end + 2);
      }
    }
    const lineComment = line.indexOf("//");
    if (lineComment !== -1) line = line.slice(0, lineComment);
    out.push(line);
  }
  return out;
}

async function main(): Promise<void> {
  const root = harnessRoot();
  const showList = process.argv.includes("--list");
  const findings: Finding[] = [];

  for await (const rel of new Glob("{hooks,tools}/**/*.ts").scan({ cwd: root })) {
    if (rel === AUTHORITY) continue;
    const src = await Bun.file(`${root}/${rel}`).text();
    const originalLines = src.split("\n");
    const codeLines = stripComments(src);

    codeLines.forEach((code, i) => {
      if (!LITERALS.test(code)) return;
      if (!PATH_CONTEXT.test(code)) return;
      const original = originalLines[i] ?? "";
      findings.push({
        file: rel,
        line: i + 1,
        text: original.trim(),
        allowed: original.includes(PRAGMA),
      });
    });
  }

  const violations = findings.filter((f) => !f.allowed);
  const allowed = findings.filter((f) => f.allowed);

  if (showList && allowed.length) {
    console.log(`allowed exceptions (${allowed.length}):`);
    for (const f of allowed) console.log(`  ${f.file}:${f.line}  ${f.text}`);
    console.log("");
  }

  if (violations.length === 0) {
    console.log(
      `PathGate: pass — no hardcoded config-root path outside ${AUTHORITY}` +
        (allowed.length ? ` (${allowed.length} pragma-allowed)` : ""),
    );
    process.exit(0);
  }

  console.error(`PathGate: FAIL — ${violations.length} hardcoded config-root path(s):\n`);
  for (const f of violations) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`    ${f.text}`);
  }
  console.error(
    `\nRoute these through ${AUTHORITY} (harnessPath / dataPath / the named helpers).\n` +
      `If a literal is genuinely required, add a \`${PRAGMA}\` comment on the line so it stays auditable.`,
  );
  process.exit(1);
}

if (import.meta.main) await main();
