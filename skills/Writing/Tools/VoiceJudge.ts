#!/usr/bin/env bun
/**
 * VoiceJudge.ts — Jev shadow for the judgment half of a voice check.
 *
 * VoiceCheck counts what can be counted. Some voice traits are judgments
 * instead ("does this apologize for a position?"), which is the yes/no shape
 * Jev answers. This asks them and LOGS the answers. It prints nothing into the
 * review and changes no verdict: shadow until a calibration run on the person's
 * real sent text shows the answers track their measured rates.
 *
 * WHERE THE QUESTIONS LIVE
 *
 * Same split as VoiceCheck's thresholds.json. The method ships here; WHICH traits
 * are asked about is a fingerprint, so the questions load at runtime from the
 * data tree at `identity/voice/judgments.json`. Without that file this tool does
 * nothing (and says so in --calibrate mode). Also a no-op unless the data tree's
 * config.toml has `[typesafe] shadow = true` and its key env var is set.
 *
 *   { "questions": { "<id>": { "instructions": "<one literal yes/no question>",
 *                              "expect": "rare" | "common" | "varies" } } }
 *
 * Invoked detached by VoiceCheck on every run, and by hand for calibration:
 *   bun VoiceJudge.ts --log <queue-file>                  (from VoiceCheck)
 *   bun VoiceJudge.ts --calibrate <dir> --channel email   (one file per message)
 *
 * Output: the data tree's state/jev-voice.jsonl.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dataPath, stateDir } from "../../../hooks/lib/paths.ts";
import { askJev, isJevError, loadJevConfig, noul, type Question } from "../../../hooks/lib/typesafe.ts";

const LOG = () => dataPath("state", "jev-voice.jsonl");

export const judgmentsFile = (): string => join(dataPath("identity", "voice"), "judgments.json");

interface Judgment { instructions: string; expect?: "rare" | "common" | "varies" }

/** The person's judgment questions, or null when the data tree supplies none. */
export function loadJudgments(path = judgmentsFile()): Record<string, Judgment> | null {
  try {
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, "utf8")) as { questions?: Record<string, Judgment> };
    const qs = Object.entries(raw.questions ?? {}).filter(([, q]) => typeof q?.instructions === "string");
    return qs.length ? Object.fromEntries(qs) : null;
  } catch {
    return null;
  }
}

export async function judge(text: string) {
  const cfg = loadJevConfig();
  const judgments = loadJudgments();
  if (!cfg || !judgments || !text.trim()) return null;
  const qs: Record<string, Question> = {};
  for (const [k, j] of Object.entries(judgments)) qs[k] = { type: "noul", instructions: j.instructions };
  const r = await askJev(cfg, text.slice(0, 20000), qs);
  if (isJevError(r)) return { error: r.error, ms: r.ms };
  return {
    model: r.model, ms: r.ms, inputTokens: r.inputTokens,
    nouls: Object.fromEntries(Object.keys(qs).map((k) => [k, noul(r, k)])),
  };
}

function append(rec: Record<string, unknown>): void {
  try { mkdirSync(stateDir(), { recursive: true }); appendFileSync(LOG(), JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n"); } catch { /* fail open */ }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const li = argv.indexOf("--log");
  if (li !== -1) {
    const file = argv[li + 1]!;
    try {
      const q = JSON.parse(readFileSync(file, "utf8")) as { text: string; channel: string; voiceCheck: unknown };
      const j = await judge(q.text);
      if (j) append({ source: "voicecheck", channel: q.channel, excerpt: q.text.slice(0, 300), words: q.text.split(/\s+/).length, voiceCheck: q.voiceCheck, ...j });
    } finally { rmSync(file, { force: true }); }
    return;
  }
  const ci = argv.indexOf("--calibrate");
  if (ci !== -1) {
    const dir = argv[ci + 1]!;
    const chi = argv.indexOf("--channel");
    const channel = chi !== -1 ? argv[chi + 1] : "unknown";
    if (!existsSync(dir)) { console.error(`no such dir: ${dir}`); process.exit(2); }
    const judgments = loadJudgments();
    if (!judgments) { console.error(`no judgment questions at ${judgmentsFile()} — nothing to calibrate`); process.exit(2); }
    if (!loadJevConfig()) { console.error("Jev not configured: config.toml [typesafe] shadow=true and the key env var are both required"); process.exit(2); }
    const files = readdirSync(dir).filter((f) => !f.startsWith("."));
    const rows: Record<string, number>[] = [];
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8");
      const j = await judge(text);
      if (!j || "error" in j) continue;
      append({ source: "calibrate", channel, file: f, words: text.split(/\s+/).length, ...j });
      rows.push(j.nouls as Record<string, number>);
    }
    // Rate at p ≥ 0.5 per trait: compare against the measured profile rates by hand.
    console.log(`${rows.length} texts judged (${channel})`);
    for (const [k, j] of Object.entries(judgments)) {
      const n = rows.filter((r) => (r[k] ?? 0) >= 0.5).length;
      console.log(`  ${k.padEnd(24)} ${String(n).padStart(3)}/${rows.length}  (${rows.length ? ((100 * n) / rows.length).toFixed(1) : "0"}%)  expect ${j.expect ?? "?"}`);
    }
    return;
  }
  console.error("usage: VoiceJudge.ts --log <queue-file> | --calibrate <dir> [--channel <c>]");
  process.exit(2);
}

if (import.meta.main) main().catch(() => {}).finally(() => process.exit(0));
