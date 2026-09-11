#!/usr/bin/env bun
/**
 * Teach the narrator how to say a word, once, for every demo on this machine.
 *
 *   glossary                                       list what is configured
 *   glossary --add Todo --say "too doo" \
 *            --host linear.app --because "Linear's workflow state"
 *   glossary --add Todo --say "toe doe" --context hobbit-names
 *   glossary --remove Todo [--host linear.app] [--context c]
 *   glossary --test "Move it to Todo" [--host h] [--context c]
 *
 * The file lives beside the voice config, in the shared config dir, so the
 * product-repo install and the global install read the same corrections.
 *
 * `--test` is the fast half of the loop: it shows what the synthesiser would be
 * handed, with no audio rendered and no video touched. Check a respelling there
 * before spending a re-narration on it.
 */
import {
  EMPTY_CONTEXT,
  type GlossaryEntry,
  applyGlossary,
  glossaryPath,
  loadGlossary,
  resolve,
  saveGlossary,
} from "./lib/glossary";
import { PRODUCT } from "./product";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
/** Repeatable flags — `--host a --host b`. */
function flags(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((arg, i) => {
    if (arg === `--${name}`) {
      const value = process.argv[i + 1];
      if (value && !value.startsWith("--")) out.push(value);
    }
  });
  return out;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function die(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (has("help")) {
  console.log(
    (await Bun.file(import.meta.path).text())
      .split("\n")
      .slice(2, 18)
      .map((l) => l.replace(/^ \* ?/, "").replace(/^\/\*\*| \*\/$/, ""))
      .join("\n")
      .replaceAll("glossary ", `${PRODUCT.cmd.glossary} `),
  );
  process.exit(0);
}

const glossary = await loadGlossary().catch((e: Error) => die(e.message));
const hosts = flags("host");
const contexts = flags("context");

function describeScope(entry: GlossaryEntry): string {
  const parts = [
    ...(entry.when?.contexts ?? []).map((c) => `context:${c}`),
    ...(entry.when?.hosts ?? []).map((h) => h),
  ];
  return parts.length ? parts.join(" ") : "everywhere";
}

/** Same identity the resolver uses: term + exact scope. */
function sameScope(entry: GlossaryEntry): boolean {
  const e = { h: entry.when?.hosts ?? [], c: entry.when?.contexts ?? [] };
  const eq = (a: string[], b: string[]) =>
    a.length === b.length &&
    [...a].sort().join("|").toLowerCase() ===
      [...b].sort().join("|").toLowerCase();
  return eq(e.h, hosts) && eq(e.c, contexts);
}

// ── add ─────────────────────────────────────────────────────────────────────
const term = flag("add");
if (term) {
  const say = flag("say");
  if (!say) {
    die(
      `--add <term> needs --say "<how it sounds>"
  e.g. ${PRODUCT.cmd.glossary} --add Todo --say "too doo" --host linear.app`,
    );
  }
  const entry: GlossaryEntry = {
    term,
    say,
    ...(hosts.length || contexts.length
      ? {
          when: {
            ...(hosts.length ? { hosts } : {}),
            ...(contexts.length ? { contexts } : {}),
          },
        }
      : {}),
    ...(flag("because") ? { because: flag("because") as string } : {}),
  };

  // Replace an entry with the SAME term and the SAME scope; a different scope
  // is a different pronunciation of the same word and must coexist with it —
  // that is the whole reason scope exists.
  const existing = glossary.entries.findIndex(
    (e) => e.term.toLowerCase() === term.toLowerCase() && sameScope(e),
  );
  if (existing >= 0) {
    glossary.entries[existing] = entry;
  } else {
    glossary.entries.push(entry);
  }

  const path = await saveGlossary(glossary);
  console.log(
    `\n✓ "${term}" → "${say}"  (${describeScope(entry)})
  ${path}

  Re-dub a recorded demo with it:
    ${PRODUCT.cmd.record} <name> --renarrate
`,
  );
  process.exit(0);
}

// ── remove ──────────────────────────────────────────────────────────────────
const removing = flag("remove");
if (removing) {
  const before = glossary.entries.length;
  glossary.entries = glossary.entries.filter(
    (e) => !(e.term.toLowerCase() === removing.toLowerCase() && sameScope(e)),
  );
  if (glossary.entries.length === before) {
    die(
      `no entry for "${removing}" with that exact scope.
  List them:  ${PRODUCT.cmd.glossary}`,
    );
  }
  await saveGlossary(glossary);
  console.log(`\n✓ removed "${removing}"\n`);
  process.exit(0);
}

// ── test ────────────────────────────────────────────────────────────────────
const sample = flag("test");
if (sample) {
  const resolved = resolve(glossary, { hosts, contexts });
  const { spoken, substitutions } = applyGlossary(sample, resolved);
  const scope = [...contexts.map((c) => `context:${c}`), ...hosts].join(", ");
  console.log(`\n  scope    ${scope || "(none — unscoped entries only)"}`);
  console.log(`  written  ${sample}`);
  console.log(`  spoken   ${spoken}`);
  if (substitutions.length === 0) {
    console.log("\n  nothing matched.\n");
  } else {
    console.log(
      `\n  ${substitutions.map((s) => `${s.term} → ${s.say} (${s.count}×)`).join("\n  ")}\n`,
    );
  }
  process.exit(0);
}

// ── list ────────────────────────────────────────────────────────────────────
if (glossary.entries.length === 0) {
  console.log(
    `\nNo pronunciations configured.
  ${glossaryPath()}

  Add one:
    ${PRODUCT.cmd.glossary} --add Todo --say "too doo" --host linear.app
`,
  );
  process.exit(0);
}

console.log(`\n${glossaryPath()}\n`);
const width = Math.max(...glossary.entries.map((e) => e.term.length));
for (const entry of glossary.entries) {
  console.log(
    `  ${entry.term.padEnd(width)}  →  ${entry.say.padEnd(width)}  ${describeScope(entry)}`,
  );
  if (entry.because) {
    console.log(`  ${" ".repeat(width)}     ${entry.because}`);
  }
}

// Report any term whose winner depends on scope, so a surprising rendering has
// somewhere to be explained. Checked against the unscoped context, where only
// the machine-wide defaults apply.
const bare = resolve(glossary, EMPTY_CONTEXT);
const scopedOnly = glossary.entries.filter(
  (e) => !bare.some((r) => r.entry === e),
);
if (scopedOnly.length > 0) {
  console.log(
    `\n  ${scopedOnly.length} entr(y/ies) apply only in scope — a demo outside it uses the default pronunciation.`,
  );
}
console.log("");
