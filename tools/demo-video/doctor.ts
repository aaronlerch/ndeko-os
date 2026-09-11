#!/usr/bin/env bun
/**
 * Report what is ready and what is not, and name the fix for each gap.
 * Mutates nothing.
 *
 *   bun run demo:doctor
 *   bun run demo:doctor --json
 *
 * This exists because exactly one prerequisite fails SILENTLY. Missing ffmpeg
 * stops a run; an unreachable database stops a run; a missing voice does not —
 * the pipeline renders the whole demo in the OS synthesiser and exits zero, and
 * a person setting this up for the first time has no way to know that is not
 * how it is supposed to sound. Everything else here is reported alongside it so
 * that "am I set up?" has one answer instead of five.
 *
 * Every check reports rather than throws, so one run shows every problem. Exit
 * code is 1 if anything required is missing, 0 if only optional pieces are —
 * which is the same contract `demo:deps --check` already uses.
 */
import type { CheckResult, DoctorCheck } from "./lib/doctor-check";
import { loadGlossary } from "./lib/glossary";
import { checkTooling } from "./lib/preflight";
import { listSessions } from "./lib/session";
import {
  configPath,
  describe,
  loadVoiceConfig,
  resolveVoice,
} from "./lib/voice";
import { PRODUCT } from "./product";

const has = (name: string) => process.argv.includes(`--${name}`);

/** Checks that are true of every install, product or not. */
const GENERIC: DoctorCheck[] = [
  {
    name: "ffmpeg + chromium",
    async run(): Promise<CheckResult> {
      const tooling = await checkTooling();
      return tooling.ok
        ? { ok: true, detail: "present" }
        : {
            ok: false,
            // The problems already carry their own install lines; the doctor's
            // job here is to attribute the verdict, not to re-render them.
            detail: `${tooling.problems.length} problem(s)`,
            fix: `${PRODUCT.cmd.deps}`,
          };
    },
  },
  {
    name: "voice",
    async run(): Promise<CheckResult> {
      const config = await loadVoiceConfig();
      const names = Object.keys(config?.profiles ?? {});
      const resolved = await resolveVoice(undefined, undefined);

      // The whole reason this script exists. A fallback resolution is not an
      // error — it records fine — but it is never what someone intended, and
      // nothing else in the pipeline will ever tell them.
      if (resolved.source === "fallback") {
        return {
          ok: false,
          warn: true,
          detail:
            "none configured — every demo will narrate in the OS synthesiser",
          fix: `${PRODUCT.cmd.voice} --help    (then --default <name>)`,
        };
      }
      if (resolved.profile.kind === "system") {
        return {
          ok: true,
          warn: true,
          detail: `${describe(resolved)} — this is the robot voice`,
          fix: `configure a local TTS binary if that is not deliberate: ${PRODUCT.cmd.voice} --help`,
        };
      }
      return {
        ok: true,
        detail: `${describe(resolved)}  (${names.length} profile(s) in ${configPath()})`,
      };
    },
  },
  {
    name: "glossary",
    async run(): Promise<CheckResult> {
      const glossary = await loadGlossary();
      const n = glossary.entries.length;
      return {
        ok: true,
        detail: n
          ? `${n} pronunciation(s)`
          : `none — narration uses the voice's defaults (${PRODUCT.cmd.glossary} --help)`,
      };
    },
  },
  {
    name: "sessions",
    async run(): Promise<CheckResult> {
      const names = await listSessions();
      return {
        ok: true,
        detail: names.length
          ? names.join(", ")
          : "none saved (only needed for a site behind a sign-in)",
      };
    },
  },
];

const results: Array<{ name: string; result: CheckResult }> = [];
for (const check of [...GENERIC, ...(await PRODUCT.extraChecks())]) {
  const result = await check.run().catch(
    (e: Error): CheckResult => ({
      ok: false,
      warn: true,
      detail: `check itself failed — ${e.message.split("\n")[0]}`,
    }),
  );
  results.push({ name: check.name, result });
}

if (has("json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log("");
  const width = Math.max(...results.map((r) => r.name.length));
  for (const { name, result } of results) {
    const mark = result.ok ? "✓" : result.warn ? "!" : "✗";
    console.log(`  ${mark}  ${name.padEnd(width)}  ${result.detail}`);
    if (!result.ok && result.fix) {
      console.log(`     ${" ".repeat(width)}  → ${result.fix}`);
    }
  }
  const blocking = results.filter((r) => !r.result.ok && !r.result.warn);
  const optional = results.filter((r) => !r.result.ok && r.result.warn);
  console.log(
    blocking.length === 0 && optional.length === 0
      ? "\n  Ready.\n"
      : blocking.length === 0
        ? `\n  Can record. ${optional.length} optional gap(s) above.\n`
        : `\n  ${blocking.length} blocking problem(s) — recording will fail.\n`,
  );
}

process.exit(results.some((r) => !r.result.ok && !r.result.warn) ? 1 : 0);
