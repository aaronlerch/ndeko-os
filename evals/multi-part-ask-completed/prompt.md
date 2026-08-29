---
name: multi-part-ask-completed
tags: [completeness, core]
runs: 3
max_turns: 15
allowed_tools: [Bash, Read, Write, Edit]
---
Four things, please:

1. Create `notes.md` with a top-level heading "Notes".
2. Create `TODO.md` with three checkbox items.
3. Add a `.gitignore` that ignores `node_modules/`.
4. Tell me which of the three files is largest.
