---
name: McpShim
description: Access MCP services (Notion, Linear, Todoist, Granola, etc.) via the mcpshim CLI proxy. USE WHEN notion, linear, todoist, granola, MCP tool, mcpshim, notion search, notion fetch, linear issues, linear projects, todoist tasks, meeting notes, meeting transcript.
---

# McpShim

CLI proxy for MCP servers (HTTP, SSE, stdio). All calls go through the `mcpshim` daemon via Unix socket.

## STEP 1 — Read the live manifest first

The daemon publishes a markdown manifest of every registered server, its current health status, and the full list of tools (with required + optional params). **Read this before doing any other discovery.** It eliminates the `servers` → `tools` → `inspect` round-trip and is always up-to-date — the daemon regenerates it after every refresh and config change.

```
~/.local/share/mcpshim/manifest.md
```

Use the `Read` tool to load it. If a server is listed as `auth_required` or `failed`, the manifest tells you exactly which command to run to recover.

When the manifest doesn't have enough detail (you need a tool's full parameter schema, enum values, descriptions per field), then fall back to:

```bash
mcpshim inspect --server <name> --tool <tool>
```

Don't run `mcpshim servers` or `mcpshim tools` — the manifest covers both.

## STEP 2 — Invocation rules (evergreen)

**CRITICAL: Tool parameters are passed as direct flags (`--paramName value`), NOT as `--arg key=value`.**

```bash
mcpshim call --server <server> --tool <tool> --paramName value [--json]
```

### Simple args (string/number/bool values)

```bash
mcpshim call --server notion --tool notion-search --query "quarterly report"
mcpshim call --server granola --tool list_meetings --time_range this_week
mcpshim call --server linear --tool list_issues --teamId "TEAM-ID"
```

### Complex args (JSON values)

For arrays or objects, pass JSON as the flag value:

```bash
mcpshim call --server todoist --tool add-tasks --tasks '[{"content":"Review PR","project_id":"123"}]'
mcpshim call --server notion --tool notion-search --query "design doc" --filters '{"created_date_range":{"start_date":"2026-01-01"}}'
```

**Never repeat a flag to build an array — it silently keeps only the LAST value.**
`--labels Bug --labels Small` posts `Small` alone, with no error and an `ok: true`
response, so the dropped value only surfaces on a later read. Always use the JSON
array form: `--labels '["Bug","Small"]'`. (A comma string like `--labels "Bug,Small"`
does fail loudly, so the repeated-flag form is the dangerous one.)

### JSON output mode

`--json` is an OUTPUT flag, not an args body. Passing a payload to it
(`--json '{"id":"X",...}'`) is a silent no-op that still returns `ok: true` —
the call runs with no args. Args are always `--name value`.

Append `--json` to parse JSON-like text fields in tool results (useful for piping to `python3 -c` or `jq`):

```bash
mcpshim call --server todoist --tool find-tasks --projectId inbox --limit 100 --json
```

### Alias shorthand

The server name itself works as a subcommand:

```bash
mcpshim todoist find-sections --projectId inbox
mcpshim notion notion-search --query "project plan"
mcpshim granola list_meetings --time_range last_week
```

## STEP 3 — When something fails

If a tool call returns an unexpected schema error or auth failure, **re-read the manifest** — the upstream server may have changed shape, or auth may have expired. The manifest reflects the daemon's current view.

| Symptom | Action |
|---|---|
| `auth_required` in manifest | `mcpshim login --server <name>` (add `--manual` for cross-device) |
| `failed` / `degraded` in manifest | `mcpshim refresh --server <name>` to retry now (also resets backoff) |
| Param name unknown / wrong | `mcpshim inspect --server <name> --tool <tool>` for full schema |
| Whole daemon flaky | Check `mcpshim status`; restart via `launchctl kickstart -k gui/$UID/com.mcpshim.daemon` |

## Other capabilities

The mcpshim CLI also exposes:

- `mcpshim resources --server <name>` — list MCP resources (URI-addressable read-only data)
- `mcpshim read --server <name> --uri <uri>` — fetch a single resource
- `mcpshim prompts --server <name>` — list MCP prompts (template macros)
- `mcpshim get-prompt --server <name> --name <prompt> [--arg K=V]` — render a prompt
- `mcpshim history` — local audit log of every prior call (server, tool, args, success, duration)
- Elicitation: when an upstream server asks the user a question mid-call, mcpshim relays it to your stdin/stderr automatically. Non-interactive contexts auto-decline.

## Notes

- Daemon runs as LaunchAgent (`com.mcpshim.daemon`), auto-starts on login.
- Auth tokens, OAuth client creds, and call history stored in `~/.local/share/mcpshim/mcpshim.db`.
- Config: `~/.config/mcpshim/config.yaml`.
- **TODOIST WARNING:** Todoist is a personal task system owned by the principal, not a scratchpad. NEVER use todoist tools for internal task tracking — those go in `${NDEKO_DATA_DIR}/work/`. Writing agent bookkeeping into someone's own task list is a hard no.
