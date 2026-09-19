/**
 * The seam between the storyboard interpreter and whatever is actually driving
 * a browser.
 *
 * `record.ts` owns the sync contract — clock, marks, holds — and nothing else.
 * An engine owns a browser and a video file. That split is what lets a
 * storyboard render through headless Playwright or through your own signed-in
 * Chrome without the storyboard, the narration or the assembler knowing.
 *
 * The one thing every engine must supply honestly is `recStartMs`: the wall
 * clock of the FIRST RECORDED FRAME, not of the call that started recording.
 * Everything downstream is arithmetic on that number — `record.ts` computes
 * `head = t0 - recStartMs` and the assembler trims it — so an engine that
 * guesses here silently desyncs the whole demo. Playwright can answer it
 * because recording begins at context creation; Interceptor can answer it
 * because `capture record start` blocks until frame zero and reports its
 * timestamp.
 */
import type { Action } from "./storyboard";

export type EngineName = "playwright" | "interceptor";

export interface EngineStartOptions {
  /** Where the walk opens. Pre-navigated before the clock starts, so frame
   *  zero of the tape is the product rather than a blank page. */
  firstUrl: string;
  viewport: { width: number; height: number };
  /** Directory the engine may write its video into. */
  videoDir: string;
  cursor: boolean;
  hideDevOverlay: boolean;
  /** Playwright storageState for a saved session. Engines that use the real
   *  browser profile ignore it — they are already signed in. */
  storageState?: unknown;
  /**
   * Let the engine strip a page's Content-Security-Policy when that is the only
   * way it can drive the page. Off unless a storyboard asks for it; see
   * engine-interceptor.ts for what it costs.
   */
  allowCspStrip?: boolean;
  /**
   * Record a tape. Default true. `false` is the dry run: the browser opens and
   * the walk performs every action for real, but nothing is written to
   * `videoDir` and `stop()` is never called — the run tears down with
   * `abort()`, which does not insist on a video. Only the Playwright engine
   * honours it; the dry run pins that engine.
   */
  record?: boolean;
}

export interface EngineStarted {
  /** Epoch ms of the first recorded frame. See the note above. */
  recStartMs: number;
  /** Human description of what is being recorded, for the run log. */
  describe: string;
}

export interface Engine {
  readonly name: EngineName;
  start(opts: EngineStartOptions): Promise<EngineStarted>;
  perform(action: Action, baseUrl: string): Promise<void>;
  /** Stop recording, finalise the file, tear down. Returns the video path. */
  stop(): Promise<{ videoPath: string }>;
  /** Best-effort teardown after a failure, so a partial video survives. Also
   *  the ordinary teardown of a dry run, which has no video to finalise. */
  abort(): Promise<{ videoPath?: string }>;
  /**
   * Write a PNG of the current viewport. The dry run calls it when an action
   * fails, so the state the target could not be found in is on disk as one
   * frame rather than buried at the end of a partial tape.
   */
  snapshot?(path: string): Promise<void>;
}
