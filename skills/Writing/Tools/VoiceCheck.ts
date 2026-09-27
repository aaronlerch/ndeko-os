#!/usr/bin/env bun
/**
 * VoiceCheck.ts — measure a draft against a measured voice profile.
 *
 * WHY THIS IS CODE AND NOT A PROMPT
 *
 * Most of what separates one person's writing from generic writing is
 * countable: hedge rate, whether a greeting exists, the ratio of words living
 * in bullets, `--` versus an em dash, whether a banned closer appears. A model
 * asked to "check the voice" will produce a plausible opinion. This produces
 * numbers, and numbers are falsifiable.
 *
 * The judgment half — does the argument land, is the disagreement stated the
 * way this person states it — stays in the workflow prose, because it genuinely
 * needs judgment. This tool handles only what it can actually decide.
 *
 * WHERE THE NUMBERS LIVE
 *
 * The method ships with the harness. The measurements do not: reference bands
 * and person-specific bans are a fingerprint, so they load at runtime from the
 * data tree at `identity/voice/thresholds.json`. Without that file the tool
 * still runs — it scrubs the universal AI tells and reports raw measurements,
 * and simply has no bands to compare against. That degraded mode is announced,
 * never silent.
 *
 * Bands are DESCRIPTIVE, not targets to optimize toward. A draft outside a band
 * is a flag to look at, never automatically wrong.
 *
 * Usage:
 *   bun VoiceCheck.ts --channel email <file>
 *   cat draft.md | bun VoiceCheck.ts --channel slack -
 *   bun VoiceCheck.ts --channel documents --json <file>
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataPath, stateDir } from "../../../hooks/lib/paths.ts";
import { loadJevConfig } from "../../../hooks/lib/typesafe.ts";

const CHANNELS = ["email", "slack", "documents", "directing-work"] as const;
type Channel = (typeof CHANNELS)[number];

interface Band {
  medianWords?: [number, number];
  hedgePer100?: [number, number];
  bulletWordPct?: [number, number];
  greetingExpected?: boolean;
  emojiExpected?: boolean;
  note?: string;
  greetingHint?: string;
  emojiHint?: string;
}

interface Overlay {
  measuredOn?: string;
  reviewAfter?: string;
  channels: Partial<Record<Channel, Band>>;
  scrub: Array<[RegExp, string]>;
  hedgeHint?: string;
  emDashHint?: string;
}

/**
 * Universal AI tells and corporate filler. These hold for anyone writing in a
 * plain register, so they ship with the tool rather than the profile. Anything
 * that is only a tell for one specific person belongs in the overlay's `scrub`.
 */
const DEFAULT_SCRUB: Array<[RegExp, string]> = [
  [/\blet me know if\b/i, "P0 closer"],
  [/\bi hope (this|that) helps\b/i, "P0 closer"],
  [/\bi'?d be happy to\b/i, "P0 filler"],
  [/\bfeel free to\b/i, "P0 filler"],
  [/\bit'?s important to note\b/i, "P0 filler"],
  [/\bin conclusion\b/i, "P0 filler"],
  [/\bto summari[sz]e\b/i, "P0 filler"],
  [/\bhere'?s the thing\b/i, "P1 AI tell"],
  [/\bhere'?s how it works\b/i, "P1 AI tell"],
  [/\bnot just .{1,40} — /i, "P1 AI tell (not just X — Y)"],
  [/\bthe cool part\b/i, "P1 AI tell"],
  [/\blet'?s dive in\b/i, "P1 AI tell"],
  [/\b(bandwidth|circle back|touch base|synergy|actionable|utilize|kindly|please advise)\b/i, "corporate filler"],
];

const HEDGES = /\b(maybe|might|perhaps|possibly|i think|i believe|probably|somewhat|fairly|rather|arguably|it seems)\b/gi;
const GREETING = /^\s*(hey|hi|hello|good (morning|afternoon)|dear)\b/i;
const EMOJI = /(:[a-z0-9_+-]+:)|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

export const thresholdsFile = (): string => join(dataPath("identity", "voice"), "thresholds.json");

/**
 * Load the personal overlay. Returns null for every failure mode — absent file,
 * unreadable file, malformed JSON, wrong shape — because none of them is a
 * reason to take the tool down. The caller announces the degraded mode.
 */
export function loadOverlay(path = thresholdsFile()): { overlay: Overlay | null; problem: string | null } {
  if (!existsSync(path)) return { overlay: null, problem: null };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { overlay: null, problem: `unreadable (${e instanceof Error ? e.message : String(e)})` };
  }
  if (!raw || typeof raw !== "object") return { overlay: null, problem: "not a JSON object" };

  const o = raw as Record<string, unknown>;
  const channels: Partial<Record<Channel, Band>> = {};
  const rawChannels = (o.channels ?? {}) as Record<string, unknown>;
  for (const c of CHANNELS) {
    const b = rawChannels[c];
    if (b && typeof b === "object") channels[c] = b as Band;
  }

  const scrub: Array<[RegExp, string]> = [];
  const badPatterns: string[] = [];
  if (Array.isArray(o.scrub)) {
    for (const entry of o.scrub) {
      if (!entry || typeof entry !== "object") continue;
      const { pattern, why } = entry as { pattern?: unknown; why?: unknown };
      if (typeof pattern !== "string") continue;
      try {
        scrub.push([new RegExp(pattern, "i"), typeof why === "string" ? why : "profile ban"]);
      } catch {
        badPatterns.push(pattern);
      }
    }
  }

  if (!Object.keys(channels).length && !scrub.length) {
    return { overlay: null, problem: "no usable channels or scrub entries" };
  }

  return {
    overlay: {
      measuredOn: typeof o.measuredOn === "string" ? o.measuredOn : undefined,
      reviewAfter: typeof o.reviewAfter === "string" ? o.reviewAfter : undefined,
      channels,
      scrub,
      hedgeHint: typeof o.hedgeHint === "string" ? o.hedgeHint : undefined,
      emDashHint: typeof o.emDashHint === "string" ? o.emDashHint : undefined,
    },
    problem: badPatterns.length ? `skipped ${badPatterns.length} invalid regex(es): ${badPatterns.join(", ")}` : null,
  };
}

interface Finding {
  level: "defect" | "flag" | "note";
  what: string;
}

function words(t: string): number {
  return t.split(/\s+/).filter(Boolean).length;
}

/** A numeric pair from JSON is only usable if it really is two finite numbers. */
function pair(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [a, b] = v;
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return [a, b];
}

export function analyze(text: string, channel: Channel, overlay: Overlay | null) {
  const band: Band = overlay?.channels[channel] ?? {};
  const banded = Boolean(overlay?.channels[channel]);
  const total = words(text);
  const lines = text.split("\n");
  const bulletWords = lines
    .filter((l) => /^\s*([-*+]|\d+\.)\s/.test(l))
    .reduce((n, l) => n + words(l), 0);

  const hedges = text.match(HEDGES)?.length ?? 0;
  const hedgeRate = total ? (hedges / total) * 100 : 0;
  const bulletPct = total ? (bulletWords / total) * 100 : 0;
  const emDash = (text.match(/—/g) ?? []).length;
  const dashDash = (text.match(/ -- /g) ?? []).length;
  const emoji = (text.match(EMOJI) ?? []).length;
  const hasGreeting = GREETING.test(lines.find((l) => l.trim()) ?? "");

  const findings: Finding[] = [];

  for (const [re, why] of [...DEFAULT_SCRUB, ...(overlay?.scrub ?? [])]) {
    const m = text.match(re);
    if (m) findings.push({ level: "defect", what: `"${m[0]}" — ${why}` });
  }

  const mw = pair(band.medianWords);
  if (mw) {
    const [loW, hiW] = mw;
    if (total < loW) findings.push({ level: "flag", what: `${total} words — short for ${channel} (typical ${loW}–${hiW})` });
    if (total > hiW) findings.push({ level: "flag", what: `${total} words — long for ${channel} (typical ${loW}–${hiW})` });
  }

  const hp = pair(band.hedgePer100);
  if (hp) {
    const [loH, hiH] = hp;
    if (hedgeRate > hiH) {
      const hint = overlay?.hedgeHint ? ` ${overlay.hedgeHint}` : "";
      findings.push({
        level: "flag",
        what: `hedging ${hedgeRate.toFixed(2)}/100w — above ${channel} band (${loH}–${hiH}).${hint}`,
      });
    }
  }

  const bp = pair(band.bulletWordPct);
  if (bp) {
    const [loB, hiB] = bp;
    if (bulletPct > hiB)
      findings.push({ level: "flag", what: `${bulletPct.toFixed(0)}% of words in bullets — above ${channel} band (${loB}–${hiB}%)` });
    if (bulletPct < loB)
      findings.push({ level: "flag", what: `${bulletPct.toFixed(0)}% of words in bullets — below ${channel} band (${loB}–${hiB}%)` });
  }

  if (banded && emDash > 0 && channel !== "documents") {
    const hint = overlay?.emDashHint ? ` — ${overlay.emDashHint}` : "";
    findings.push({ level: "flag", what: `${emDash} em dash(es)${hint}` });
  }

  if (band.greetingExpected === true && !hasGreeting)
    findings.push({ level: "note", what: `no greeting${band.greetingHint ? ` — ${band.greetingHint}` : ` — ${channel} usually opens with one`}` });
  if (band.greetingExpected === false && hasGreeting && channel === "directing-work")
    findings.push({ level: "flag", what: "greeting present — absent from this channel's corpus" });

  if (band.emojiExpected === true && emoji === 0)
    findings.push({ level: "note", what: `no emoji${band.emojiHint ? ` — ${band.emojiHint}` : ""}` });
  if (band.emojiExpected === false && emoji > 0 && channel !== "email")
    findings.push({ level: "flag", what: `${emoji} emoji — absent from ${channel}` });

  return { total, hedgeRate, bulletPct, emDash, dashDash, emoji, hasGreeting, findings, band, banded };
}

/**
 * Hand the draft to VoiceJudge (Jev, shadow-only) in a detached process. It logs
 * judgments to the data tree and never touches this tool's output or exit code.
 * No-op unless [typesafe] shadow is on and its key is set.
 */
function shadowJudge(text: string, channel: Channel, r: ReturnType<typeof analyze>): void {
  try {
    if (!loadJevConfig()) return;
    const dir = join(stateDir(), "jev-queue");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `voice-${randomUUID()}.json`);
    const { findings, total, hedgeRate, bulletPct } = r;
    writeFileSync(file, JSON.stringify({ text, channel, voiceCheck: { total, hedgeRate, bulletPct, findings } }));
    spawn(process.execPath, [join(import.meta.dir, "VoiceJudge.ts"), "--log", file], { detached: true, stdio: "ignore" }).unref();
  } catch { /* shadow must never break the check */ }
}

function main(): void {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const ci = argv.indexOf("--channel");
  const channel = (ci !== -1 ? argv[ci + 1] : undefined) as Channel | undefined;
  const target = argv.filter((a) => !a.startsWith("--") && a !== channel).at(-1);

  if (!channel || !CHANNELS.includes(channel) || !target) {
    console.error(`usage: VoiceCheck.ts --channel <${CHANNELS.join("|")}> [--json] <file|->`);
    process.exit(2);
  }

  const { overlay, problem } = loadOverlay();
  const text = target === "-" ? readFileSync(0, "utf8") : readFileSync(target, "utf8");
  const r = analyze(text, channel, overlay);
  shadowJudge(text, channel, r);

  if (json) {
    console.log(JSON.stringify({ ...r, profileLoaded: Boolean(overlay), profileProblem: problem }, null, 2));
    process.exit(r.findings.some((f) => f.level === "defect") ? 1 : 0);
  }

  console.log(`channel: ${channel}   words: ${r.total}   hedges: ${r.hedgeRate.toFixed(2)}/100w   bullets: ${r.bulletPct.toFixed(0)}%`);
  console.log(`emoji: ${r.emoji}   em-dash: ${r.emDash}   " -- ": ${r.dashDash}   greeting: ${r.hasGreeting ? "yes" : "no"}`);

  if (!overlay) {
    console.log(
      `\n  NO PROFILE  ${thresholdsFile()}` +
        `\n              ${problem ?? "not found"}` +
        `\n              Measurements above are real; band comparisons are SKIPPED.` +
        `\n              This is a raw reading, not a voice check — say so when reporting it.\n`,
    );
  } else {
    if (problem) console.log(`\n  PROFILE WARNING  ${problem}`);
    if (!r.banded) console.log(`\n  NO BAND  profile has no '${channel}' channel — band comparisons skipped for it.`);
    if (r.band.note) console.log(`\n${r.band.note}\n`);
    else console.log("");
  }

  const defects = r.findings.filter((f) => f.level === "defect");
  const flags = r.findings.filter((f) => f.level === "flag");
  const notes = r.findings.filter((f) => f.level === "note");

  for (const [label, set] of [["DEFECT", defects], ["FLAG", flags], ["NOTE", notes]] as const) {
    for (const f of set) console.log(`  ${label}  ${f.what}`);
  }
  if (!r.findings.length) console.log("  no findings");

  const staleness =
    overlay?.reviewAfter && overlay.reviewAfter < new Date().toISOString().slice(0, 10)
      ? `\nProfile passed its review date (${overlay.reviewAfter}). Voice drifts — treat the bands as evidence, not law.`
      : "";

  console.log(
    `\nBands are descriptive, not targets. A flag means look, not fix.` +
      ` Argument shape and how disagreement lands are judgment — see Workflows/Review.md.${staleness}`,
  );
  process.exit(defects.length ? 1 : 0);
}

if (import.meta.main) main();
