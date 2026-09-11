/**
 * Platform-correct "how do I install this" strings.
 *
 * The pipeline's tooling errors used to say `brew install ffmpeg` on every
 * platform, which is wrong everywhere except a Mac and actively unhelpful in a
 * cloud session or a Linux container — the one place someone is most likely to
 * be missing ffmpeg in the first place.
 *
 * Linux is not one answer. We read /etc/os-release and name the package manager
 * that machine actually has, falling back to listing the common ones only when
 * the ID is unrecognised.
 */
import { readFileSync } from "node:fs";

/** Package names differ per manager for some tools; keep the map explicit. */
interface PackageNames {
  brew: string;
  apt: string;
  dnf: string;
  pacman: string;
  apk: string;
  /**
   * A command that must run BEFORE the install one, per manager. Used where a
   * distro's own repositories genuinely cannot supply the package.
   */
  prereq?: Partial<Record<Manager, string>>;
}

const PACKAGES: Record<string, PackageNames> = {
  ffmpeg: {
    brew: "ffmpeg",
    apt: "ffmpeg",
    dnf: "ffmpeg",
    pacman: "ffmpeg",
    apk: "ffmpeg",
    // Fedora and RHEL ship only `ffmpeg-free`, which omits libx264 — the exact
    // encoder assemble.ts muxes with. RPM Fusion is not a nicety here, it is the
    // only way to get a usable build. (Verified against fedora:40, 2026-08-31:
    // `dnf list ffmpeg` returns nothing; only ffmpeg-free exists.)
    prereq: {
      dnf: "sudo dnf install -y https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm",
    },
  },
  "espeak-ng": {
    brew: "espeak-ng",
    apt: "espeak-ng",
    dnf: "espeak-ng",
    pacman: "espeak-ng",
    apk: "espeak-ng",
  },
};

type Manager = "brew" | "apt" | "dnf" | "pacman" | "apk";

const COMMAND: Record<Manager, (pkg: string) => string> = {
  brew: (p) => `brew install ${p}`,
  apt: (p) => `sudo apt-get update && sudo apt-get install -y ${p}`,
  dnf: (p) => `sudo dnf install -y ${p}`,
  pacman: (p) => `sudo pacman -S --needed ${p}`,
  apk: (p) => `sudo apk add ${p}`,
};

/**
 * Which package manager this machine uses. Derived from os-release rather than
 * probing PATH: a box can have several installed and only one that owns the
 * system packages.
 */
export function detectManager(osRelease?: string): Manager | null {
  if (osRelease === undefined) {
    if (process.platform === "darwin") return "brew";
    if (process.platform !== "linux") return null;
  }

  let release = osRelease ?? "";
  if (osRelease === undefined) {
    try {
      release = readFileSync("/etc/os-release", "utf8");
    } catch {
      return null;
    }
  }
  const field = (key: string) =>
    release
      .split("\n")
      .find((line) => line.startsWith(`${key}=`))
      ?.slice(key.length + 1)
      .replace(/^"|"$/g, "")
      .toLowerCase() ?? "";

  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/).filter(Boolean);
  for (const id of ids) {
    if (["debian", "ubuntu", "linuxmint", "pop", "raspbian"].includes(id)) {
      return "apt";
    }
    if (["fedora", "rhel", "centos", "rocky", "almalinux"].includes(id)) {
      return "dnf";
    }
    if (["arch", "archlinux", "manjaro", "endeavouros"].includes(id)) {
      return "pacman";
    }
    if (id === "alpine") return "apk";
  }
  return null;
}

/**
 * A ready-to-paste install command for this machine, or — when the distro is
 * unrecognised — every command we know, so the reader can pick their own.
 */
export function installHint(tool: keyof typeof PACKAGES | string): string {
  const names = PACKAGES[tool];
  if (!names) return `install ${tool}`;

  const manager = detectManager();
  if (manager) {
    const cmd = COMMAND[manager](names[manager]);
    const prereq = names.prereq?.[manager];
    return prereq ? `${prereq}\n     ${cmd}` : cmd;
  }

  const all = (["apt", "dnf", "pacman", "apk"] as const)
    .map((m) => `       ${COMMAND[m](names[m])}`)
    .join("\n");
  return `install ${tool}:\n${all}`;
}
