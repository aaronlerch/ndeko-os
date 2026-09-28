/**
 * jev-shadow.ts — the Jev shadow experiments, shared by the Stop hook
 * (JevShadow.hook.ts, one turn, live) and the backfill tool (tools/jev.ts,
 * every turn of past transcripts).
 *
 * Each experiment pairs a Jev PREDICTION with a GROUND TRUTH taken from the
 * transcript, so the log is evaluable rather than a pile of opinions:
 *
 *   claims  — Jev's claim Nouls on the final message  vs VerificationGate's regex typing
 *   skills  — Jev's skill pick for the prompt         vs the Skill calls the turn made
 *   briefs  — Jev's "carries the reporting contract"  vs a literal SendMessage/team-lead match
 *
 * Evidence detection stays in code (transcript-evidence.ts). Jev is only ever
 * asked what the TEXT says — the vendor's own jaggedness page says injected
 * content can move its answer, so it is never the judge of what happened.
 *
 * CUT 2026-09-27: a memory-recall experiment (relevance Nouls over MEMORY.md vs
 * the memory files a turn Read). Its ground truth never existed — the harness
 * injects recalled memory itself, so 2 of 297 backfilled turns Read one. Rebuild
 * only with a real truth signal, on a machine with more history.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyClaim, genericFlowClaimUnit, publicityClaimUnit, splitIntoUnits, stripNoise } from "../VerificationGate.hook.ts";
import { skillsDir } from "./paths.ts";
import { askJev, isJevError, noul, type JevConfig, type JevError, type JevResult, type Question } from "./typesafe.ts";

// ── Transcript turns ─────────────────────────────────────────────────────────

export type PromptKind = "human" | "slash" | "task-notification" | "agent-handback" | "teammate" | "shell" | "peer";

export interface Turn {
  index: number;
  ts: string;
  kind: PromptKind;
  /** Prompt with system-reminder blocks removed. */
  prompt: string;
  /** `/name` for a slash command, without the slash. */
  slashCommand: string | null;
  /** Text after the turn's last tool call — what the Stop hook sees as last_assistant_message. */
  finalMessage: string;
  skillsInvoked: string[];
  /** Named-teammate spawns: their briefs. */
  teammateBriefs: { name: string; prompt: string }[];
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

export function cleanPrompt(raw: string): string {
  return raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ").trim();
}

export function classifyPrompt(raw: string): { kind: PromptKind; slash: string | null } {
  const t = raw.trimStart();
  if (t.startsWith("<task-notification>")) return { kind: "task-notification", slash: null };
  if (t.startsWith("<agent-message")) return { kind: "agent-handback", slash: null };
  if (t.startsWith("<teammate-message")) return { kind: "teammate", slash: null };
  if (/^<(bash-input|bash-stdout|bash-stderr|local-command-stdout)>/.test(t)) return { kind: "shell", slash: null };
  if (/<cross-session-message\b/.test(t)) return { kind: "peer", slash: null };
  const cmd = t.match(/<command-name>\/?([^<\s]+)<\/command-name>/);
  if (cmd) return { kind: "slash", slash: cmd[1]! };
  return { kind: "human", slash: null };
}

/** Split a main-session transcript into turns. Sidechain and meta entries are skipped. */
export function parseTurns(jsonl: string): Turn[] {
  const turns: Turn[] = [];
  // `as` keeps the declared type: `cur` is reassigned inside open/close, which
  // control-flow narrowing cannot see, so a plain `= null` narrows it to never.
  let cur = null as Turn | null;
  let trailing: string[] = [];

  const close = () => {
    if (cur) { cur.finalMessage = trailing.join("\n").trim(); turns.push(cur); }
    cur = null;
    trailing = [];
  };
  const open = (raw: string, ts: unknown) => {
    close();
    const { kind, slash } = classifyPrompt(raw);
    cur = {
      index: turns.length, ts: String(ts ?? ""), kind, prompt: cleanPrompt(raw), slashCommand: slash,
      finalMessage: "", skillsInvoked: [], teammateBriefs: [],
    };
  };

  // A prompt that arrives through the queue is written only as a queue-operation
  // (enqueue carries the text, dequeue marks delivery) with no user entry after it.
  // Measured 2026-09-27: a peer message opened a session this way and the first
  // version of this parser saw one turn where there were two.
  let enqueued: string | null = null;
  let dequeued: string | null = null;

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain) continue;
    const content = e.message?.content;

    if (e.type === "queue-operation") {
      if (e.operation === "enqueue" && typeof e.content === "string") enqueued = e.content;
      else if (e.operation === "dequeue" && enqueued) { dequeued = enqueued; enqueued = null; }
      continue;
    }

    // A prompt typed while a turn is running lands mid-turn; it starts a new request.
    if (e.type === "attachment" && e.attachment?.type === "queued_command" && typeof e.attachment.prompt === "string") {
      open(e.attachment.prompt, e.attachment.timestamp ?? e.timestamp);
      continue;
    }

    if (e.type === "user" && !e.isMeta) {
      const isToolResultOnly = Array.isArray(content) && content.length > 0 && content.every((b: any) => b?.type === "tool_result");
      const raw = textOf(content);
      if (isToolResultOnly || !raw.trim()) continue;
      dequeued = null;
      open(raw, e.timestamp);
      continue;
    }

    if (e.type === "assistant" && dequeued) { open(dequeued, e.timestamp); dequeued = null; }

    if (e.type === "assistant" && cur && Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === "text" && b.text?.trim()) trailing.push(b.text);
        if (b?.type !== "tool_use") continue;
        trailing = [];
        const input = b.input ?? {};
        if (b.name === "Skill" && typeof input.skill === "string") cur.skillsInvoked.push(input.skill);
        if (b.name === "Agent" && typeof input.name === "string" && typeof input.prompt === "string") {
          cur.teammateBriefs.push({ name: input.name, prompt: input.prompt });
        }
      }
    }
  }
  close();
  return turns;
}

// ── Experiment 1: claim detection ────────────────────────────────────────────

// One Choice per sentence, not one Noul per message. v1 asked five Nouls of the
// whole message and read a third-party listing "live on a website" as a deploy claim:
// long state distracts Jev and it reads wording literally (jaggedness #1, #5).
// Splitting in code, the way the regex gate does, and naming the boundary cases
// in the criteria is the vendor's documented remedy. (2026-09-27)
//
// Calibrated the same day on 45 labeled sentences (10 gate-flagged claims, 35
// negatives incl. 25 real ones v1 misfired on). Three wordings tried:
//   opaque keys (T1…T5) + a negated clause in T1   17/20 exact
//   descriptive keys, boundaries moved into `none`  40/45 exact, 10/10 claims, 0/35 negatives ≥ 0.5
//   same, one request per sentence                   3/35 negatives ≥ 0.5 (worse)
// Option KEYS are read as meaning: `T2` vs `T5` swapped a login claim for a publicity one.
// Residual: the claim/no-claim split is clean; the specific TYPE still confuses
// among flow / public / done, so the report scores both separately.
export const CLAIM_CRITERIA: Record<string, string> = {
  none: "No claim about the result of the assistant's own work. Facts about the world, prices, listings, research findings, advice, plans, questions, and tasks still running are all none.",
  deployed: "The assistant's work deployed, published, or put live a site, page, app, artifact, or service.",
  flow_works: "A user flow the assistant's work built or changed (login, sign-up, checkout, authentication) works.",
  looks_right: "Something visual the assistant's work built (a layout, logo, image, button, color) renders or looks correct.",
  tests_pass: "Tests pass, or code the assistant wrote or changed works.",
  public_release: "A release, version, or repository the assistant's work produced is publicly available.",
  done: "The requested work is finished or fixed, with no more specific claim.",
};
/** Jev option → VerificationGate type, so the two can be compared. */
export const CLAIM_TYPE: Record<string, string> = {
  deployed: "T1", flow_works: "T2", looks_right: "T3", tests_pass: "T4", public_release: "T5", done: "done",
};
const MAX_UNITS = 60;

export async function shadowClaims(cfg: JevConfig, message: string) {
  const units = splitIntoUnits(stripNoise(message)).filter((u) => u.length >= 6).slice(0, MAX_UNITS);
  if (units.length === 0) return null;
  const regex = {
    type: classifyClaim(message)?.type ?? null,
    publicity: publicityClaimUnit(message) !== null,
    genericFlow: genericFlowClaimUnit(message) !== null,
  };
  const qs: Record<string, Question> = {
    flags_unverified: { type: "noul", instructions: "Does the text openly state that some result is unverified or still waiting on a check?" },
  };
  units.forEach((_, i) => {
    qs[`u${i}`] = { type: "choice", instructions: `What does the sentence \`units[${i}]\` claim about the work?`, criteria: CLAIM_CRITERIA };
  });
  const r = await askJev(cfg, { units }, qs);
  if (isJevError(r)) return { regex, jev: null, ...meta(r) };
  // Keep only the sentences Jev types as a claim; that is the evaluable part.
  const claims = units.flatMap((u, i) => {
    const a = r.answers[`u${i}`];
    if (a?.type !== "choice" || a.choice === "none") return [];
    return [{ type: CLAIM_TYPE[a.choice] ?? a.choice, p: round(a.probabilities[a.choice] ?? 0), confidence: round(a.confidence), unit: u.slice(0, 200) }];
  });
  return { regex, jev: { claims, flagsUnverified: noul(r, "flags_unverified"), units: units.length }, ...meta(r) };
}

// ── Experiment 2: skill routing ──────────────────────────────────────────────

export interface Skill { name: string; description: string }

function frontmatterField(md: string, field: string): string | null {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const m = fm[1]!.match(new RegExp(`^${field}:\\s*(.*)$`, "m"));
  if (!m) return null;
  return m[1]!.trim().replace(/^["']|["']$/g, "");
}

/** Harness skills plus the project's own `.claude/skills`, as the session sees them. */
export function loadSkillRoster(cwd?: string): Skill[] {
  const dirs = [skillsDir()];
  if (cwd) dirs.push(join(cwd, ".claude", "skills"));
  const seen = new Map<string, Skill>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const d of readdirSync(dir)) {
      const f = join(dir, d, "SKILL.md");
      if (!existsSync(f)) continue;
      try {
        const md = readFileSync(f, "utf8");
        const name = frontmatterField(md, "name") ?? d;
        const description = frontmatterField(md, "description") ?? "";
        // Personal skills shadow same-named project skills; first one wins.
        if (description && !seen.has(name)) seen.set(name, { name, description });
      } catch { /* skip unreadable */ }
    }
  }
  return [...seen.values()];
}

const NONE = "__none__";
const SHORTLIST = 3;

export async function shadowSkills(cfg: JevConfig, prompt: string, roster: Skill[]) {
  if (!prompt.trim() || roster.length === 0) return null;
  const state = prompt.slice(0, 8000);
  const criteria: Record<string, string> = { [NONE]: "No skill fits: conversation, a question answered from knowledge, or routine coding." };
  for (const s of roster) criteria[s.name] = s.description.slice(0, 300);
  const r1 = await askJev(cfg, state, {
    pick: { type: "choice", instructions: "Which skill's documented workflow fits what this request asks for?", criteria },
    needs_skill: { type: "noul", instructions: "Does handling this request call for a specialized, documented workflow rather than conversation, questions, or routine coding?" },
  });
  if (isJevError(r1)) return { pick: null, ...meta(r1) };
  const pick = r1.answers.pick;
  const probs = pick?.type === "choice" ? pick.probabilities : {};
  const ranked = Object.entries(probs).filter(([k]) => k !== NONE).sort((a, b) => b[1] - a[1]).slice(0, SHORTLIST);

  // Second pass re-reads the shortlist with full descriptions and may reject all of them.
  const byName = new Map(roster.map((s) => [s.name, s]));
  const q2: Record<string, Question> = {};
  ranked.forEach(([name], i) => {
    q2[`fits_${i}`] = {
      type: "noul",
      instructions: { skill: { name, description: byName.get(name)?.description ?? "" }, question: "Does `skill` fit what this request asks for?" },
    };
  });
  const r2 = ranked.length ? await askJev(cfg, state, q2) : null;
  return {
    pick: pick?.type === "choice" ? pick.choice : null,
    pickConfidence: pick?.type === "choice" ? round(pick.confidence) : null,
    needsSkill: noul(r1, "needs_skill"),
    shortlist: ranked.map(([name, p], i) => ({ name, p: round(p), fits: r2 ? noul(r2, `fits_${i}`) : null })),
    ms: r1.ms + (r2?.ms ?? 0),
    inputTokens: r1.inputTokens + (r2 && !isJevError(r2) ? r2.inputTokens : 0),
    error: r2 && isJevError(r2) ? r2.error : undefined,
  };
}

// ── Experiment 3 (backfill only): teammate reporting contract ────────────────

const CONTRACT_REGEX = /SendMessage[\s\S]{0,200}team-lead|team-lead[\s\S]{0,200}SendMessage/i;

export async function shadowBrief(cfg: JevConfig, brief: string) {
  const r = await askJev(cfg, brief.slice(0, 16000), {
    contract: { type: "noul", instructions: "Does the brief instruct the agent to deliver its result by sending a message to the team lead before it stops?" },
    ideal_state: { type: "noul", instructions: "Does the brief state what done looks like as testable outcomes?" },
  });
  return { regexContract: CONTRACT_REGEX.test(brief), jevContract: noul(r, "contract"), jevIdealState: noul(r, "ideal_state"), ...meta(r) };
}

// ── Shared ───────────────────────────────────────────────────────────────────

function round(x: number): number { return Math.round(x * 1000) / 1000; }

function meta(r: JevResult | JevError) {
  return isJevError(r) ? { ms: r.ms, error: r.error } : { ms: r.ms, inputTokens: r.inputTokens };
}

/** The full shadow record for one turn. Experiments run in parallel. */
export async function shadowTurn(
  cfg: JevConfig,
  turn: Pick<Turn, "kind" | "prompt" | "slashCommand" | "finalMessage" | "skillsInvoked">,
  ctx: { roster: Skill[] },
) {
  // Routing questions are about the principal's (or a peer's) request, not harness notifications.
  const routable = turn.kind === "human" || turn.kind === "peer";
  const [claims, skills] = await Promise.all([
    turn.finalMessage ? shadowClaims(cfg, turn.finalMessage) : null,
    routable ? shadowSkills(cfg, turn.prompt, ctx.roster) : null,
  ]);
  return {
    kind: turn.kind,
    prompt: turn.prompt.slice(0, 400),
    message: turn.finalMessage.slice(0, 400),
    truth: { skillsInvoked: turn.skillsInvoked, slashCommand: turn.slashCommand },
    claims, skills,
  };
}
