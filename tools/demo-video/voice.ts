#!/usr/bin/env bun
/**
 * Set up and inspect the local demo voice. Run once per machine.
 *
 *   bun run demo:voice                         show what is configured
 *   bun run demo:voice --add aaron \
 *     --command ~/path/to/tts \
 *     --args 'tts --profile aaron --model turbo --text {{text}} --out {{out}}'
 *   bun run demo:voice --add clear --system --system-voice Samantha
 *   bun run demo:voice --default aaron
 *   bun run demo:voice --test aaron
 *
 * The config lives OUTSIDE this repo, at
 * ${XDG_CONFIG_HOME:-~/.config}/demo-video/voice.json, so a path to your
 * own TTS binary never becomes a fact this repository depends on. Storyboards
 * reference a voice by NAME; whether that name resolves to a cloned neural voice
 * or the OS synthesiser is a property of the machine, not of the demo.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeDuration } from "./lib/tts";
import {
  type VoiceConfig,
  type VoiceProfile,
  configPath,
  describe,
  loadVoiceConfig,
  saveVoiceConfig,
  speak,
} from "./lib/voice";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

if (has("help")) {
  console.log(
    (await Bun.file(import.meta.path).text())
      .split("\n")
      .slice(2, 24)
      .map((l) => l.replace(/^ \* ?/, "").replace(/^\/\*\*| \*\/$/, ""))
      .join("\n"),
  );
  process.exit(0);
}

const config: VoiceConfig = (await loadVoiceConfig()) ?? { profiles: {} };

// ── add ─────────────────────────────────────────────────────────────────────
const add = flag("add");
if (add) {
  let profile: VoiceProfile;
  if (has("system")) {
    profile = {
      kind: "system",
      voice: flag("system-voice"),
      rate: flag("rate")
        ? Number.parseInt(flag("rate") as string, 10)
        : undefined,
      label: flag("label") ?? "system synthesiser",
    };
  } else if (has("cloud")) {
    profile = {
      kind: "cloud",
      provider: "openai",
      model: flag("model"),
      voice: flag("cloud-voice"),
      label: flag("label") ?? "openai tts",
    };
    console.log(
      "note: the cloud tier is stubbed — see scripts/demo-video/lib/voice.ts",
    );
  } else {
    const command = flag("command");
    const args = flag("args");
    if (!command || !args) {
      console.error(
        "--add <name> needs --command <path> and --args '<argv template>'\n" +
          "  The template must contain {{text}} and {{out}}.",
      );
      process.exit(1);
    }
    if (!args.includes("{{text}}") || !args.includes("{{out}}")) {
      console.error("--args must contain both {{text}} and {{out}}");
      process.exit(1);
    }
    profile = {
      kind: "command",
      command: command.replace(/^~/, process.env.HOME ?? "~"),
      args: args.split(/\s+/),
      label: flag("label") ?? "local custom voice",
    };
  }
  config.profiles[add] = profile;
  config.default ??= add;
  const path = await saveVoiceConfig(config);
  console.log(`added "${add}" to ${path}`);
  if (config.default === add) console.log(`"${add}" is now the default`);
}

// ── default ─────────────────────────────────────────────────────────────────
const setDefault = flag("default");
if (setDefault) {
  if (!config.profiles[setDefault]) {
    console.error(
      `no profile "${setDefault}". Known: ${Object.keys(config.profiles).join(", ") || "(none)"}`,
    );
    process.exit(1);
  }
  config.default = setDefault;
  await saveVoiceConfig(config);
  console.log(`default is now "${setDefault}"`);
}

// ── test ────────────────────────────────────────────────────────────────────
const test = flag("test") ?? (has("test") ? config.default : undefined);
if (has("test")) {
  const name = test ?? config.default;
  const profile = name ? config.profiles[name] : undefined;
  if (!name || !profile) {
    console.error("nothing to test — no profile named and no default set");
    process.exit(1);
  }
  const out = join(tmpdir(), `demo-voice-${name}.wav`);
  const text =
    flag("text") ??
    "This is the property setup experience we just built for our customers.";
  console.log(`rendering with "${name}"…`);
  try {
    await speak(profile, text, out);
    console.log(`  ${out}  ${(await probeDuration(out)).toFixed(1)}s`);
    console.log(`  play it:  afplay ${out}`);
  } catch (e) {
    console.error(`  failed: ${(e as Error).message}`);
    process.exit(1);
  }
}

// ── show ────────────────────────────────────────────────────────────────────
if (!add && !setDefault && !has("test")) {
  console.log(`config: ${configPath()}`);
  const names = Object.keys(config.profiles);
  if (names.length === 0) {
    console.log(
      "\nNo voices configured. Demos will use the system synthesiser.\n" +
        "Add your own:  bun run demo:voice --help",
    );
  } else {
    console.log(`default: ${config.default ?? "(none)"}\n`);
    for (const name of names) {
      const p = config.profiles[name] as VoiceProfile;
      console.log(
        `  ${name.padEnd(14)} ${describe({ name, profile: p, source: "config-default" })}`,
      );
    }
  }
  console.log(
    "\nA storyboard picks a voice by name (its `voice` field); " +
      "--voice overrides it per run.",
  );
}
