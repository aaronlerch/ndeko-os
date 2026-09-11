/**
 * Voice resolution — three tiers, set up once, overridable per demo.
 *
 *   1. command  a local TTS binary you already have (a cloned voice, say)
 *   2. cloud    a hosted TTS API                          — STUBBED, see below
 *   3. system   the OS speech synthesiser: `say` / `espeak-ng`
 *
 * Nothing about tier 1 lives in this repo. The binary's path and arguments go in
 * a per-machine config file OUTSIDE the checkout, so the same storyboard renders
 * in whatever voice each machine has:
 *
 *   ${XDG_CONFIG_HOME:-~/.config}/demo-video/voice.json
 *
 * That location is deliberate, not incidental. An environment variable was the
 * obvious alternative and is worse twice over: a project that gates its
 * `process.env` reads (as the one this was built in does) would have to declare
 * a `DEMO_TTS_CMD` repo-wide before this could read it at all, and an exported
 * variable does not survive a new shell or a fresh worktree. A config file
 * survives both and belongs to the machine rather than to any checkout.
 *
 * Precedence, highest first:
 *   --voice <name>  →  storyboard.voice  →  config.default  →  system tier
 *
 * A name that is asked for and missing is an error. This never silently
 * downgrades to the robot voice — a demo that quietly stopped sounding like you
 * is worse than one that refused to render.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PRODUCT } from "../product";
import { configDir } from "./config-dir";
import { installHint } from "./install-hint";

export type VoiceProfile =
  | {
      kind: "command";
      /** Executable path or a name on PATH. */
      command: string;
      /** argv template. `{{text}}` and `{{out}}` are substituted per clip. */
      args: string[];
      /** Shown in the run manifest. */
      label?: string;
    }
  | {
      kind: "cloud";
      provider: "openai";
      model?: string;
      voice?: string;
      label?: string;
    }
  | {
      kind: "system";
      /** macOS `say -v` name, or espeak-ng `-v` name. Omit for the default. */
      voice?: string;
      /** Words per minute. */
      rate?: number;
      label?: string;
    };

export interface VoiceConfig {
  /** Profile used when neither the CLI nor the storyboard names one. */
  default?: string;
  profiles: Record<string, VoiceProfile>;
}

export interface ResolvedVoice {
  name: string;
  profile: VoiceProfile;
  /** Where the choice came from — recorded in the run manifest. */
  source: "flag" | "storyboard" | "config-default" | "fallback";
}

export function configPath(): string {
  return join(configDir(), "voice.json");
}

export async function loadVoiceConfig(): Promise<VoiceConfig | null> {
  const path = configPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as VoiceConfig;
  } catch (e) {
    throw new Error(`${path} is not valid JSON — ${(e as Error).message}`);
  }
}

export async function saveVoiceConfig(config: VoiceConfig): Promise<string> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

/** The tier-3 profile used when nothing else is configured. */
export function systemFallback(): VoiceProfile {
  return { kind: "system", label: "system default" };
}

export async function resolveVoice(
  fromFlag: string | undefined,
  fromStoryboard: string | undefined,
): Promise<ResolvedVoice> {
  const config = await loadVoiceConfig();
  const asked = fromFlag ?? fromStoryboard;
  const source: ResolvedVoice["source"] = fromFlag ? "flag" : "storyboard";

  if (asked) {
    const profile = config?.profiles?.[asked];
    if (!profile) {
      throw new Error(
        `voice "${asked}" is not configured.\n  Looked in: ${configPath()}\n  Known: ${Object.keys(config?.profiles ?? {}).join(", ") || "(none)"}\n  Set one up:  ${PRODUCT.cmd.voice} --help`,
      );
    }
    return { name: asked, profile, source };
  }

  if (config?.default) {
    const profile = config.profiles?.[config.default];
    if (!profile) {
      throw new Error(
        `${configPath()}: default is "${config.default}" but no such profile exists`,
      );
    }
    return { name: config.default, profile, source: "config-default" };
  }

  return { name: "system", profile: systemFallback(), source: "fallback" };
}

/**
 * Render one clip to `out` (a .wav path). Returns nothing; throws on failure.
 *
 * Text is always passed as an argv element, never interpolated into a shell
 * string — narration is authored content and may contain quotes and apostrophes.
 */
export async function speak(
  profile: VoiceProfile,
  text: string,
  out: string,
): Promise<void> {
  switch (profile.kind) {
    case "command": {
      const args = profile.args.map((a) =>
        a.replaceAll("{{text}}", text).replaceAll("{{out}}", out),
      );
      await run(profile.command, args);
      return;
    }
    case "cloud":
      throw new Error(`Cloud TTS is stubbed.\n${PRODUCT.cloudStubHint}`);
    case "system": {
      if (process.platform === "darwin") {
        // `say` writes AIFF; convert rather than trusting --data-format to
        // infer a container from the extension.
        const aiff = `${out}.aiff`;
        const args = ["-o", aiff];
        if (profile.voice) args.push("-v", profile.voice);
        if (profile.rate) args.push("-r", String(profile.rate));
        args.push(text);
        await run("say", args);
        await run("ffmpeg", ["-y", "-v", "error", "-i", aiff, out]);
        await Bun.file(aiff)
          .unlink()
          .catch(() => {});
        return;
      }
      const args = ["-w", out];
      if (profile.voice) args.push("-v", profile.voice);
      if (profile.rate) args.push("-s", String(profile.rate));
      args.push(text);
      await run("espeak-ng", args);
      return;
    }
  }
}

/**
 * Named so `run` can annotate the handle without widening it. `ReturnType<typeof
 * Bun.spawn>` is the un-piped default, where `stderr` is
 * `number | ReadableStream | undefined` — the pipe options are what narrow it,
 * and only an inferred type keeps them.
 */
const spawnPiped = (command: string, args: string[]) =>
  Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });

async function run(command: string, args: string[]): Promise<void> {
  let proc: ReturnType<typeof spawnPiped>;
  try {
    proc = spawnPiped(command, args);
  } catch {
    throw new Error(
      `${command} could not be executed. ${
        command === "espeak-ng" || command === "ffmpeg"
          ? `Install it:  ${installHint(command)}`
          : "Check the path in the voice config."
      }`,
    );
  }
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`${command} exited ${code}: ${err.slice(-600)}`);
  }
}

/** One-line description for logs and the run manifest. */
export function describe(v: ResolvedVoice): string {
  const tier =
    v.profile.kind === "command"
      ? "local custom voice"
      : v.profile.kind === "cloud"
        ? "cloud voice"
        : "system voice";
  const label = v.profile.label ? ` (${v.profile.label})` : "";
  return `${v.name}${label} — ${tier}, chosen by ${v.source}`;
}
