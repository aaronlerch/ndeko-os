import type { TakeRecording } from "./record";
/**
 * Lay every narration clip onto the recorded video at its segment's mark, mix
 * them into one track, and mux to H.264.
 *
 * Takes are concatenated in order, so each take's marks shift by the summed real
 * duration of the takes before it — measured with ffprobe, not taken from the
 * walk's own stopwatch, because Playwright's webm length and the wall-clock
 * total are not the same number.
 */
import { type Timing, probeDuration } from "./tts";

export interface AssembleResult {
  output: string;
  duration: number;
  clipsPlaced: number;
}

export async function assemble(
  takes: TakeRecording[],
  timings: Timing[],
  output: string,
): Promise<AssembleResult> {
  if (takes.length === 0) throw new Error("nothing to assemble");
  const fileFor = new Map(timings.map((t) => [t.id, t.file]));

  // Absolute offset of each take on the stitched timeline. Each take's
  // `head` (tape recorded before the walk's clock started — the blank page
  // and the pre-navigation) is trimmed below, so the stitched timeline is
  // the trimmed durations, and marks (clock-relative) line up with it.
  const offsets: number[] = [];
  let running = 0;
  for (const take of takes) {
    offsets.push(running);
    running += (await probeDuration(take.videoPath)) - take.head;
  }

  const inputs: string[] = [];
  for (const take of takes) inputs.push("-i", take.videoPath);

  // Trim every take's head in the filter graph (frame-accurate, unlike an
  // input `-ss` seek on a sparse-keyframe webm) — frame zero of the output
  // is the product, not Chromium's white about:blank.
  const filters: string[] = takes.map(
    (take, i) =>
      `[${i}:v]trim=start=${take.head.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`,
  );
  const videoLabel = takes.length === 1 ? "[v0]" : "[v]";
  if (takes.length > 1) {
    const streams = takes.map((_, i) => `[v${i}]`).join("");
    filters.push(`${streams}concat=n=${takes.length}:v=1:a=0[v]`);
  }

  const audioLabels: string[] = [];
  takes.forEach((take, ti) => {
    for (const mark of take.marks) {
      const file = fileFor.get(mark.id);
      if (!file) continue; // silent beat
      const index = takes.length + audioLabels.length;
      inputs.push("-i", file);
      const ms = Math.max(
        0,
        Math.round((mark.t + (offsets[ti] as number)) * 1000),
      );
      filters.push(`[${index}:a]adelay=${ms}|${ms}[a${audioLabels.length}]`);
      audioLabels.push(`[a${audioLabels.length}]`);
    }
  });

  const maps = ["-map", videoLabel];
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
  if (filters.length > 0) args.push("-filter_complex", filters.join(";"));
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
  };
}
