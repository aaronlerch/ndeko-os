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
import type { Segment } from "./storyboard";
import { type ResolvedVoice, speak } from "./voice";

export interface Timing {
  id: string;
  seconds: number;
  file: string;
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
    const hash = sha(`${fingerprint} ${seg.say}`, 12);
    const file = `${audioDir}/${seg.id}.${hash}.wav`;
    const cached = existsSync(file);
    if (!cached) await speak(voice.profile, seg.say, file);
    const seconds = await probeDuration(file);
    timings.push({ id: seg.id, seconds, file });
    console.log(
      `  ${seg.id}  ${seconds.toFixed(1)}s${cached ? "  (cached)" : ""}`,
    );
  }
  return timings;
}
