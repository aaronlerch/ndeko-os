#!/usr/bin/env bun
/**
 * jev.ts — backfill and report for the Jev shadow experiments.
 *
 * The live Stop hook (hooks/JevShadow.hook.ts) grows the corpus one turn at a
 * time. `backfill` runs the same experiments over past transcripts, so the
 * evaluation starts with weeks of data instead of waiting for them. `report`
 * reads both logs and prints where Jev and the ground truth disagree, which is
 * the only part worth a human's attention.
 *
 * Nothing here changes behavior. Output goes to the data tree's state/ only.
 *
 * Usage:
 *   bun tools/jev.ts backfill [--days 30] [--limit N] [--concurrency 4]
 *   bun tools/jev.ts report [--examples 8]
 */

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { dataPath, harnessPath } from "../hooks/lib/paths.ts";
import { loadJevConfig } from "../hooks/lib/typesafe.ts";
import { loadSkillRoster, parseTurns, shadowBrief, shadowTurn } from "../hooks/lib/jev-shadow.ts";

const BACKFILL = () => dataPath("state", "jev-backfill.jsonl");
const LIVE = () => dataPath("state", "jev-shadow.jsonl");

function arg(name: string, dflt: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : Number(process.argv[i + 1]);
}

function readLog(path: string): any[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

/** Main-session transcripts modified in the window. Subagent transcripts are excluded. */
function transcripts(days: number): string[] {
  const root = harnessPath("projects");
  const cutoff = Date.now() - days * 86_400_000;
  const out: string[] = [];
  for (const proj of readdirSync(root)) {
    const dir = join(root, proj);
    try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(dir, f);
      try { if (statSync(p).mtimeMs >= cutoff) out.push(p); } catch { /* skip */ }
    }
  }
  return out.sort();
}

function cwdOf(raw: string): string | undefined {
  const m = raw.match(/"cwd":"([^"]+)"/);
  return m?.[1];
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]!); }));
}

async function backfill(): Promise<void> {
  const cfg = loadJevConfig();
  if (!cfg) { console.error("Jev not configured: config.toml [typesafe] shadow=true and the key env var are both required."); process.exit(1); }
  const days = arg("days", 30), limit = arg("limit", Infinity), conc = arg("concurrency", 4);
  const done = new Set(readLog(BACKFILL()).map((r) => `${r.session}#${r.turn}#${r.brief ?? ""}`));

  type Job = { session: string; cwd?: string; turn: ReturnType<typeof parseTurns>[number] };
  const jobs: Job[] = [];
  for (const p of transcripts(days)) {
    const raw = readFileSync(p, "utf8");
    const session = basename(p, ".jsonl");
    for (const turn of parseTurns(raw)) jobs.push({ session, cwd: cwdOf(raw), turn });
  }
  const todo = jobs.filter((j) => !done.has(`${j.session}#${j.turn.index}#`)).slice(0, limit);
  console.log(`${jobs.length} turns in window, ${todo.length} to run (concurrency ${conc})`);

  const rosters = new Map<string, ReturnType<typeof loadSkillRoster>>();
  let n = 0, tokens = 0, errors = 0;
  await pool(todo, conc, async (j) => {
    const key = j.cwd ?? "";
    if (!rosters.has(key)) rosters.set(key, loadSkillRoster(j.cwd));
    const rec: any = await shadowTurn(cfg, j.turn, { roster: rosters.get(key)! });
    const base = { ts: new Date().toISOString(), source: "backfill", model: cfg.model, session: j.session, cwd: j.cwd, turn: j.turn.index, turnTs: j.turn.ts };
    appendFileSync(BACKFILL(), JSON.stringify({ ...base, ...rec }) + "\n");
    for (const part of [rec.claims, rec.skills]) {
      tokens += part?.inputTokens ?? 0;
      if (part?.error) errors++;
    }
    for (const b of j.turn.teammateBriefs) {
      if (done.has(`${j.session}#${j.turn.index}#${b.name}`)) continue;
      const br = await shadowBrief(cfg, b.prompt);
      tokens += br.inputTokens ?? 0;
      appendFileSync(BACKFILL(), JSON.stringify({ ...base, brief: b.name, briefResult: br }) + "\n");
    }
    if (++n % 50 === 0) console.log(`  ${n}/${todo.length}  ${(tokens / 1e6).toFixed(2)}M tokens  ${errors} errors`);
  });
  console.log(`done: ${n} turns, ${(tokens / 1e6).toFixed(2)}M input tokens (~$${((tokens / 1e6) * 0.042).toFixed(2)}), ${errors} request errors`);
}

// ── Report ───────────────────────────────────────────────────────────────────


const YES = 0.5;
/** Claims: 0.5 is noise on a 7-way Choice; the 2026-09-27 backfill showed real misses cluster at ≥ 0.9. */
const CLAIM_YES = 0.9;

function pct(a: number, b: number): string { return b ? `${((100 * a) / b).toFixed(0)}%` : "n/a"; }
function ex(s: string): string { return (s ?? "").replace(/\s+/g, " ").slice(0, 140); }

function report(): void {
  const k = arg("examples", 8);
  const recs = [...readLog(BACKFILL()), ...readLog(LIVE())];
  const turns = recs.filter((r) => !r.brief);
  const briefs = recs.filter((r) => r.brief);
  console.log(`# Jev shadow report — ${turns.length} turns (${recs.filter((r) => r.source === "live").length} live), ${briefs.length} briefs\n`);

  // Claims: regex type vs Jev's strongest type Noul.
  // Only the gate's typed claims (T1–T5) are compared; "done" is logged but the gate has no type for it.
  const c = turns.filter((r) => Array.isArray(r.claims?.jev?.claims));
  const jevClaims = (r: any) => r.claims.jev.claims.filter((x: any) => x.type !== "done" && x.p >= CLAIM_YES);
  const regexTyped = (r: any) => Boolean(r.claims.regex.type || r.claims.regex.publicity);
  const regexOnly = c.filter((r) => regexTyped(r) && jevClaims(r).length === 0);
  const jevOnly = c.filter((r) => !regexTyped(r) && jevClaims(r).length > 0);
  const both = c.filter((r) => regexTyped(r) && jevClaims(r).length > 0);
  const sameType = both.filter((r) => jevClaims(r).some((x: any) => x.type === (r.claims.regex.type ?? "T5")));
  console.log(`## 1. Claims (${c.length} messages)`);
  console.log(`both flag a claim: ${both.length} (same type ${sameType.length}) · regex only (candidate regex FPs): ${regexOnly.length} · Jev only (candidate regex misses): ${jevOnly.length}`);
  console.log(`\nJev only — read these for real claims the gate never saw:`);
  for (const r of jevOnly.slice(0, k)) for (const x of jevClaims(r).slice(0, 2)) console.log(`- [${x.type} ${x.p}] ${ex(x.unit)}`);
  console.log(`\nRegex only — read these for regex false positives:`);
  for (const r of regexOnly.slice(0, k)) console.log(`- [${r.claims.regex.type ?? "T5"}] ${ex(r.message)}`);

  // Skills: pick vs what fired.
  // Older records predate the teammate/shell kinds; filter those prompts by shape too.
  const notRequest = (r: any) => /^<(teammate-message|bash-input|bash-stdout|bash-stderr|local-command-stdout)/.test(r.prompt ?? "");
  const s = turns.filter((r) => r.skills?.pick !== undefined && r.skills?.pick !== null && !notRequest(r));
  const fired = s.filter((r) => r.truth.skillsInvoked.length > 0);
  const hit = fired.filter((r) => r.truth.skillsInvoked.some((x: string) => x.toLowerCase() === String(r.skills.pick).toLowerCase()));
  const topFits = (r: any) => Math.max(0, ...(r.skills.shortlist ?? []).map((x: any) => x.fits ?? 0));
  const misses = s.filter((r) => r.truth.skillsInvoked.length === 0 && topFits(r) >= YES && (r.skills.needsSkill ?? 0) >= YES);
  console.log(`\n## 2. Skills (${s.length} routable prompts, ${fired.length} fired a skill)`);
  console.log(`Jev pick matched the skill that fired: ${hit.length}/${fired.length} (${pct(hit.length, fired.length)})`);
  console.log(`candidate misses (no skill fired, Jev fits ≥ ${YES} and needs-skill ≥ ${YES}): ${misses.length} (${pct(misses.length, s.length)})`);
  for (const r of misses.slice(0, k)) console.log(`- ${r.skills.shortlist[0]?.name}: ${ex(r.prompt)}`);

  // Briefs.
  const b = briefs.filter((r) => r.briefResult?.jevContract !== null && r.briefResult?.jevContract !== undefined);
  const agree = b.filter((r) => (r.briefResult.jevContract >= YES) === r.briefResult.regexContract);
  console.log(`\n## 3. Teammate briefs (${b.length})`);
  console.log(`carries contract — regex: ${b.filter((r) => r.briefResult.regexContract).length}, Jev: ${b.filter((r) => r.briefResult.jevContract >= YES).length}, agree: ${pct(agree.length, b.length)}`);
  console.log(`states done as testable outcomes (Jev): ${b.filter((r) => (r.briefResult.jevIdealState ?? 0) >= YES).length}/${b.length}`);

  const errs = turns.flatMap((r) => [r.claims?.error, r.skills?.error].filter(Boolean));
  const ms = turns.flatMap((r) => [r.claims?.ms].filter((x) => typeof x === "number")).sort((a, b) => a - b);
  console.log(`\n## Health\nrequest errors: ${errs.length} · single-request latency p50 ${ms[Math.floor(ms.length / 2)] ?? "n/a"}ms, p95 ${ms[Math.floor(ms.length * 0.95)] ?? "n/a"}ms`);
}

const cmd = process.argv[2];
if (cmd === "backfill") await backfill();
else if (cmd === "report") report();
else { console.error("usage: bun tools/jev.ts backfill|report"); process.exit(1); }
