---
name: GoogleWorkspace
description: Google Workspace operations via the `gws` CLI (v0.22.5) — Gmail, Drive, Calendar, Docs, Sheets, Slides, Chat, Meet, Tasks, People/Contacts, Forms, Keep, Classroom, Apps Script, Admin Reports, Workspace Events, and Model Armor. Use for any Google Workspace API work on the account configured in the data tree. USE WHEN gws, google workspace, gmail send, gmail search, drive upload, drive share, calendar event, meeting invite, google doc, google sheet, google slides, google chat, google meet, google tasks, google contacts, google forms, google keep, apps script, admin audit log, workspace events subscription.
---

# Google Workspace (gws)

Uniform access to Google Workspace APIs via the `gws` CLI. Preconfigured for `the account configured in the data tree` (OAuth, 24 scopes, tokens in macOS Keychain — see `~/.config/gws/`).

> **`gog` has been retired.** Do not invoke `gog` — it is no longer installed. All Google Workspace work goes through `gws`.

## Before you do anything: read Shared

The shared baseline has auth, global flags, output formatting, quotas, and security rules. Every service skill below assumes you've read it.

**Read first:** `gws-shared/SKILL.md`

## How the skill layout works

The skill ships **85 reference files** organized into 3 categories. You **do not load them all** — treat them like man pages. When a task matches a category below, `Read` the listed file(s) to get the exact schema, flags, and examples.

All paths are relative to this skill's directory: `${NDEKO_DIR}/skills/GoogleWorkspace/`.

## Discovering schemas at runtime

For any method whose parameters you're not sure about, inspect the schema before calling:

```bash
gws <service> --help
gws schema <service>.<resource>.<method>
```

`gws schema` prints the exact `--params` / `--json` shape — prefer this over guessing.

---

## 1. Core Service References (18 files)

One per Google Workspace service. Read the matching file when starting work on that service — it lists resources, methods, and helper commands.

| When the user asks about… | Read this file |
|---|---|
| Gmail (read/send/search/label/thread) | `gws-gmail/SKILL.md` |
| Drive (files, folders, shared drives) | `gws-drive/SKILL.md` |
| Calendar (events, calendars) | `gws-calendar/SKILL.md` |
| Docs (read/write Google Docs) | `gws-docs/SKILL.md` |
| Sheets (read/write spreadsheets) | `gws-sheets/SKILL.md` |
| Slides (presentations) | `gws-slides/SKILL.md` |
| Chat (spaces, messages, memberships) | `gws-chat/SKILL.md` |
| Meet (conference spaces, recordings) | `gws-meet/SKILL.md` |
| Tasks (task lists & tasks) | `gws-tasks/SKILL.md` |
| People / Contacts / Directory | `gws-people/SKILL.md` |
| Forms (read/write Google Forms) | `gws-forms/SKILL.md` |
| Keep (notes — service account only) | `gws-keep/SKILL.md` |
| Classroom (courses, rosters, coursework) | `gws-classroom/SKILL.md` |
| Apps Script projects | `gws-script/SKILL.md` |
| Admin audit logs & usage reports | `gws-admin-reports/SKILL.md` |
| Workspace Events subscriptions | `gws-events/SKILL.md` |
| Cross-service workflows | `gws-workflow/SKILL.md` |
| Model Armor safety filtering | `gws-modelarmor/SKILL.md` |

## 2. Helper Commands (26 files)

Thin wrappers over common ops. Prefer these over raw API calls when they match the intent — they handle ergonomic details (MIME parsing, threading, auto-metadata) you shouldn't re-derive.

| Intent | Read this file | Calls |
|---|---|---|
| Send a new email | `gws-gmail-send/SKILL.md` | `gws gmail +send` |
| Reply to a message (preserves thread) | `gws-gmail-reply/SKILL.md` | `gws gmail +reply` |
| Reply-all (preserves thread) | `gws-gmail-reply-all/SKILL.md` | `gws gmail +reply-all` |
| Forward a message | `gws-gmail-forward/SKILL.md` | `gws gmail +forward` |
| Read a message body/headers | `gws-gmail-read/SKILL.md` | `gws gmail +read` |
| Unread inbox summary | `gws-gmail-triage/SKILL.md` | `gws gmail +triage` |
| Watch inbox / stream new mail | `gws-gmail-watch/SKILL.md` | `gws gmail +watch` |
| Show upcoming agenda | `gws-calendar-agenda/SKILL.md` | `gws calendar +agenda` |
| Create a calendar event | `gws-calendar-insert/SKILL.md` | `gws calendar +insert` |
| Send a Chat message | `gws-chat-send/SKILL.md` | `gws chat +send` |
| Append text to a Doc | `gws-docs-write/SKILL.md` | `gws docs +write` |
| Upload a file to Drive | `gws-drive-upload/SKILL.md` | `gws drive +upload` |
| Subscribe to Workspace Events | `gws-events-subscribe/SKILL.md` | `gws events +subscribe` |
| Renew an events subscription | `gws-events-renew/SKILL.md` | `gws events +renew` |
| Create a Model Armor template | `gws-modelarmor-create-template/SKILL.md` | `gws modelarmor +create-template` |
| Sanitize a prompt | `gws-modelarmor-sanitize-prompt/SKILL.md` | `gws modelarmor +sanitize-prompt` |
| Sanitize a response | `gws-modelarmor-sanitize-response/SKILL.md` | `gws modelarmor +sanitize-response` |
| Read a sheet range | `gws-sheets-read/SKILL.md` | `gws sheets +read` |
| Weekly digest workflow | `gws-workflow-weekly-digest/SKILL.md` | `gws workflow +weekly-digest` |
| Standup report workflow | `gws-workflow-standup-report/SKILL.md` | `gws workflow +standup-report` |
| Email-to-task workflow | `gws-workflow-email-to-task/SKILL.md` | `gws workflow +email-to-task` |
| File announce workflow | `gws-workflow-file-announce/SKILL.md` | `gws workflow +file-announce` |

Remaining helpers (list with `ls ${NDEKO_DIR}/skills/GoogleWorkspace/ | grep ^gws-`): additional per-service sub-commands follow the same naming pattern `gws-<service>-<verb>`.

## 3. Recipes (41 files)

Pre-composed multi-step flows. Read one when the user's ask matches the recipe's intent — it gives you the exact sequence and the services involved.

| User intent | Recipe file |
|---|---|
| Save attachments from matching emails to Drive | `recipe-save-email-attachments/SKILL.md` |
| Forward all emails with a specific label | `recipe-forward-labeled-emails/SKILL.md` |
| Create a Gmail filter | `recipe-create-gmail-filter/SKILL.md` |
| Set a vacation responder | `recipe-create-vacation-responder/SKILL.md` |
| Label and archive matching emails | `recipe-label-and-archive-emails/SKILL.md` |
| Draft an email from a Doc | `recipe-draft-email-from-doc/SKILL.md` |
| Save an email to a Doc | `recipe-save-email-to-doc/SKILL.md` |
| Send a team-wide announcement | `recipe-send-team-announcement/SKILL.md` |
| Reschedule a meeting | `recipe-reschedule-meeting/SKILL.md` |
| Schedule a recurring event | `recipe-schedule-recurring-event/SKILL.md` |
| Find free time across attendees | `recipe-find-free-time/SKILL.md` |
| Plan a weekly schedule | `recipe-plan-weekly-schedule/SKILL.md` |
| Share event materials with attendees | `recipe-share-event-materials/SKILL.md` |
| Bulk-download a Drive folder | `recipe-bulk-download-folder/SKILL.md` |
| Create a shared Drive | `recipe-create-shared-drive/SKILL.md` |
| Share a folder with a team | `recipe-share-folder-with-team/SKILL.md` |
| Share a Doc and notify | `recipe-share-doc-and-notify/SKILL.md` |
| Watch a Drive folder for changes | `recipe-watch-drive-changes/SKILL.md` |
| Create a Doc from a template | `recipe-create-doc-from-template/SKILL.md` |
| Create a presentation | `recipe-create-presentation/SKILL.md` |
| Back up a Sheet as CSV | `recipe-backup-sheet-as-csv/SKILL.md` |
| Generate a report from a Sheet | `recipe-generate-report-from-sheet/SKILL.md` |
| Create an expense tracker | `recipe-create-expense-tracker/SKILL.md` |
| Create a feedback form | `recipe-create-feedback-form/SKILL.md` |
| Collect form responses | `recipe-collect-form-responses/SKILL.md` |
| Sync contacts to a Sheet | `recipe-sync-contacts-to-sheet/SKILL.md` |
| Create a Meet space | `recipe-create-meet-space/SKILL.md` |
| Log a deal update | `recipe-log-deal-update/SKILL.md` |
| Post-mortem setup | `recipe-post-mortem-setup/SKILL.md` |

(Remaining recipes follow the same `recipe-<intent>` naming — discover with `ls`.)

---

## Invocation rules

- **Auth is already set up.** No `gws auth login` unless `gws auth status` reports a problem.
- **Account scoping.** All calls operate on `the account configured in the data tree` by default. Do not pass another account unless the user explicitly asks.
- **Never print credentials.** Do not run `gws auth export`, `cat ~/.config/gws/credentials.*`, or anything that surfaces token material.
- **JSON-first.** Use `--format json` for anything you'll parse. `--format table` is for human display only.
- **Schema, not guesswork.** Before calling an unfamiliar method, run `gws schema <service>.<resource>.<method>` to see the parameter shape.
- **Recipes are templates, not guardrails.** You may adapt a recipe's steps to the user's specifics; don't invent steps that contradict a recipe's stated sequence without reason.

## Historical note (gog → gws)

This harness previously used a CLI called `gog` (`/opt/homebrew/bin/gog`, v0.9.0) for Google Workspace access. It was retired on 2026-04-23 in favor of `gws`. If you encounter a reference to `gog` in code or documentation, treat it as a migration bug and replace with the `gws` equivalent. The two CLIs have **different argument shapes** (`gog <svc> <verb> --flag` vs `gws <svc> <resource> <method> --params '{...}'`) — not a sed replacement.
