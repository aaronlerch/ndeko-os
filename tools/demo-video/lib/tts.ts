import { createHash } from "node:crypto";
/**
 * Narration clips, and the timings the walk holds each screen to.
 *
 * This runs BEFORE the recording, and that order is the whole sync design: the
 * walk reads each clip's measured duration and holds the screen at least that
 * long, so audio and video line up by arithmetic instead of by a runtime race.
 *
 * Clips are cached by a hash of (text + voice profile). A local neural voice is
 * 15-25 s of CPU per clip; editing one line of narration should not cost four
 * minutes of regeneration.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import {
  type ResolvedTerm,
  type Substitution,
  applyGlossary,
} from "./glossary";
import type { Segment } from "./storyboard";
import { type ResolvedVoice, speak } from "./voice";

export interface Timing {
  id: string;
  seconds: number;
  file: string;
  /**
   * What the synthesiser was actually given, when the glossary rewrote it.
   * Recorded so the manifest can show why a clip says something the storyboard
   * does not literally contain.
   */
  spoken?: string;
  substitutions?: Substitution[];
}

export async function probeDuration(file: string): Promise<number> {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      file,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const code = await proc.exited;
  const text = (await new Response(proc.stdout).text()).trim();
  const seconds = Number.parseFloat(text);
  if (code !== 0 || !Number.isFinite(seconds)) {
    throw new Error(`ffprobe could not read a duration from ${file}`);
  }
  return seconds;
}

/**
 * Short content hash. Wrapped in one place because `validate-audit-coverage`
 * reads a chained crypto call as a Drizzle write, and nothing in this pipeline
 * touches the database.
 */
// audit-exempt: crypto hash, not a Drizzle write.
function sha(input: string, length: number): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

export async function renderNarration(
  segments: Segment[],
  voice: ResolvedVoice,
  audioDir: string,
  glossary: ResolvedTerm[] = [],
): Promise<Timing[]> {
  await mkdir(audioDir, { recursive: true });
  const fingerprint = sha(JSON.stringify(voice.profile), 8);

  const timings: Timing[] = [];
  for (const seg of segments) {
    if (!seg.say.trim()) {
      timings.push({ id: seg.id, seconds: 0, file: "" });
      console.log(`  ${seg.id}  (silent)`);
      continue;
    }
    // Hash the SPOKEN text, not the authored text. A glossary edit then
    // invalidates exactly the clips whose audio actually changed and nothing
    // else — the cache stays correct for free, with no version stamp to keep
    // in sync and no way for a stale clip to survive a pronunciation fix.
    const { spoken, substitutions } = applyGlossary(seg.say, glossary);
    const hash = sha(`${fingerprint} ${spoken}`, 12);
    const file = `${audioDir}/${seg.id}.${hash}.wav`;
    const cached = existsSync(file);
    if (!cached) await speak(voice.profile, spoken, file);
    const seconds = await probeDuration(file);
    timings.push({
      id: seg.id,
      seconds,
      file,
      ...(substitutions.length > 0 ? { spoken, substitutions } : {}),
    });
    const said = substitutions.map((s) => `${s.term}→${s.say}`).join(", ");
    console.log(
      `  ${seg.id}  ${seconds.toFixed(1)}s${cached ? "  (cached)" : ""}${said ? `  [${said}]` : ""}`,
    );
  }
  return timings;
}
