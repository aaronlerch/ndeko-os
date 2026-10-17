import type { TakeRecording } from "./record";
/**
 * Cut every take into one piece per segment, drop the `cut` segments, stitch
 * the rest, and lay each narration clip at the start of its piece.
 *
 * A segment's footage runs from its mark to the next mark (or the end of the
 * take). Working per piece instead of per take is what makes two things
 * possible that a single timeline cannot do:
 *
 * - **Cuts.** A segment that waits on something slow by nature — a model's
 *   two-minute turn — is performed and recorded, then simply not included.
 * - **Re-narration after recording.** When a clip is rewritten to describe what
 *   the footage actually shows and comes out longer than the screen was held,
 *   its piece is extended by holding the last frame, rather than the clip
 *   running over the next segment's visuals. On an ordinary run every clip
 *   already fits, by construction, and the pieces join back into exactly the
 *   timeline a single trim would have produced.
 *
 * Each take's `head` (tape recorded before the walk's clock started) falls
 * before its first mark, so it is never inside any piece.
 */
import { type Timing, probeDuration } from "./tts";

export interface AssembleResult {
  output: string;
  duration: number;
  clipsPlaced: number;
  /** Segments whose piece was extended to fit their narration, in seconds. */
  frozen: { id: string; seconds: number }[];
}

export interface AssembleOptions {
  /** Segment ids whose footage is dropped. */
  cut: Set<string>;
  /** Seconds of silence a clip is given after it ends, as the walk held. */
  pad: number;
  /**
   * Transparent PNG composited into the bottom-right corner of every frame
   * (see `lib/watermark.ts`). Omit for none.
   */
  watermark?: string;
}

interface Piece {
  take: number;
  id: string;
  start: number;
  end: number;
  /** Seconds of held last frame appended to fit the clip. */
  freeze: number;
  clip?: string;
}

export async function assemble(
  takes: TakeRecording[],
  timings: Timing[],
  output: string,
  opts: AssembleOptions,
): Promise<AssembleResult> {
  if (takes.length === 0) throw new Error("nothing to assemble");
  const timing = new Map(timings.map((t) => [t.id, t]));

  const pieces: Piece[] = [];
  for (const [ti, take] of takes.entries()) {
    const tape = await probeDuration(take.videoPath);
    for (const [mi, mark] of take.marks.entries()) {
      if (opts.cut.has(mark.id)) continue;
      const next = take.marks[mi + 1];
      const start = take.head + mark.t;
      const end = Math.min(tape, next ? take.head + next.t : tape);
      if (end - start < 0.05) continue;
      const t = timing.get(mark.id);
      const need = t?.file ? t.seconds + opts.pad : 0;
      pieces.push({
        take: ti,
        id: mark.id,
        start,
        end,
        freeze: Math.max(0, need - (end - start)),
        clip: t?.file || undefined,
      });
    }
  }
  if (pieces.length === 0) throw new Error("every segment was cut");

  const inputs: string[] = [];
  for (const take of takes) inputs.push("-i", take.videoPath);

  const filters: string[] = [];
  // One input stream cannot feed several trims directly — split it first.
  for (const [ti] of takes.entries()) {
    const mine = pieces.filter((p) => p.take === ti);
    if (mine.length === 0) continue;
    const outs = mine.map((_, k) => `[t${ti}s${k}]`).join("");
    filters.push(`[${ti}:v]split=${mine.length}${outs}`);
  }
  const seen = new Map<number, number>();
  pieces.forEach((p, i) => {
    const k = seen.get(p.take) ?? 0;
    seen.set(p.take, k + 1);
    // Trim in the filter graph (frame-accurate, unlike an input `-ss` seek on
    // a sparse-keyframe webm), normalise the rate so held frames are counted
    // at it, then hold the last frame if the clip needs longer.
    const hold =
      p.freeze > 0
        ? `,tpad=stop_mode=clone:stop_duration=${p.freeze.toFixed(3)}`
        : "";
    filters.push(
      `[t${p.take}s${k}]trim=start=${p.start.toFixed(3)}:end=${p.end.toFixed(3)},setpts=PTS-STARTPTS,fps=30${hold}[p${i}]`,
    );
  });
  filters.push(
    `${pieces.map((_, i) => `[p${i}]`).join("")}concat=n=${pieces.length}:v=1:a=0${opts.watermark ? "[cv]" : "[v]"}`,
  );

  let audioBase = takes.length;
  if (opts.watermark) {
    inputs.push("-i", opts.watermark);
    // A single still: overlay repeats its one frame for the whole video. The
    // margin scales with the frame the same way the label does.
    filters.push(
      `[${takes.length}:v]format=rgba[wm]`,
      "[cv][wm]overlay=x=main_w-overlay_w-main_h*0.025:y=main_h-overlay_h-main_h*0.025:format=auto[v]",
    );
    audioBase += 1;
  }

  const audioLabels: string[] = [];
  let at = 0;
  for (const p of pieces) {
    if (p.clip) {
      const index = audioBase + audioLabels.length;
      inputs.push("-i", p.clip);
      const ms = Math.round(at * 1000);
      filters.push(`[${index}:a]adelay=${ms}|${ms}[a${audioLabels.length}]`);
      audioLabels.push(`[a${audioLabels.length}]`);
    }
    at += p.end - p.start + p.freeze;
  }

  const maps = ["-map", "[v]"];
  if (audioLabels.length > 0) {
    // normalize=0 is load-bearing. amix's default scales every input by 1/N, and
    // with a dozen clips the narration comes out nearly inaudible. The clips
    // never overlap, so mixing at unity is the correct choice.
    const mix = "amix=inputs=";
    const opts = ":normalize=0:dropout_transition=0[narration]";
    filters.push(`${audioLabels.join("")}${mix}${audioLabels.length}${opts}`);
    maps.push("-map", "[narration]");
  }

  const args = ["-y", "-v", "error", ...inputs];
  args.push("-filter_complex", filters.join(";"));
  args.push(
    ...maps,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
  );
  if (audioLabels.length > 0) args.push("-c:a", "aac", "-b:a", "160k");
  args.push("-movflags", "+faststart", output);

  const proc = Bun.spawn(["ffmpeg", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg exited ${code}:\n${err.slice(-2000)}`);
  }

  return {
    output,
    duration: await probeDuration(output),
    clipsPlaced: audioLabels.length,
    frozen: pieces
      .filter((p) => p.freeze > 0.05)
      .map((p) => ({ id: p.id, seconds: p.freeze })),
  };
}
