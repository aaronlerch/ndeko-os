---
name: Remotion
disable-model-invocation: true
description: "Creates programmatic video with React via Remotion — builds compositions, sequences, and motion graphics rendered to MP4. Uses useCurrentFrame() for all animation (no CSS animations). Integrates THEME constants from Theme.ts for visual consistency. Render command: bunx remotion render {composition-id} ~/Downloads/{name}.mp4. Output always to ~/Downloads/ for preview first. Tools: Render.ts (render, list compositions, create projects) and Theme.ts (the theme constants derived from Art). Reference docs: ThemeReference.md (theme constants, color mapping), Patterns.md (code examples, presets), CriticalRules.md (what not to do), Tools/Ref-*.md (31 pattern files covering core Remotion, Lambda, ElevenLabs captions, AI pipeline). Supports ElevenLabs captions, Lambda rendering, and AI pipeline integration. Rendering is CPU-intensive — use run_in_background. Two primary workflows: ContentToAnimation (animate existing content) and GeneratedContentVideo (AI content to video / make a short). USE WHEN: video, animation, motion graphics, video rendering, React video, render video, animate content, make a short, create animations, video overlay, explainer video, animated explainer, content to video, programmatic video. NOT FOR static images or illustrations — this harness has no image-generation path. NOT FOR diagrams (render Mermaid in an Artifact). NOT FOR audio cleanup (use AudioEditor)."
effort: medium
---

# Remotion

Create professional videos programmatically with React.

## Workflow Routing

| Trigger | Workflow |
|---------|----------|
| "animate this", "create animations for", "video overlay" | `Workflows/ContentToAnimation.md` |
| "generate video", "AI video", "content to video", "make a short" | `Workflows/GeneratedContentVideo.md` |

## Quick Reference

- **Theme:** Always use THEME from `Tools/Theme.ts`
- **Art Integration:** Load Art preferences before creating content
- **Critical:** NO CSS animations - use `useCurrentFrame()` only
- **Output:** Always to `~/Downloads/` first
- **CLI:** `bunx` always (never `npx`)

**Render command:**
```bash
bunx remotion render {composition-id} ~/Downloads/{name}.mp4
```

## Full Documentation

- **Art integration:** `ThemeReference.md` - theme constants, color mapping
- **Common patterns:** `Patterns.md` - code examples, presets
- **Critical rules:** `CriticalRules.md` - what NOT to do
- **Detailed reference:** `Tools/Ref-*.md` - 31 pattern files covering core Remotion + Lambda + ElevenLabs captions + AI pipeline

## Tools

| Tool | Purpose |
|------|---------|
| `Tools/Render.ts` | Render, list compositions, create projects |
| `Tools/Theme.ts` | the theme constants derived from Art |

## Links

- Remotion Docs: https://remotion.dev/docs
- GitHub: https://github.com/remotion-dev/remotion

## Gotchas

- **React-based video — component patterns differ from web React.** Remotion has specific composition, sequence, and timing APIs.
- **Rendering is CPU-intensive.** Use `run_in_background: true` for render commands.
- **Output goes to ~/Downloads/ first** for preview. Same as images.
- **NOT for static images** — and there is no image-generation skill here either. Diagrams go to Mermaid in an Artifact.

## Examples

**Example 1: Create animated explainer**
```
User: "create a video showing how the Algorithm works"
→ Builds React composition with Remotion
→ Defines sequences, animations, timing
→ Renders to MP4 in background
→ Output to ~/Downloads/ for preview
```

## Execution Log

After completing any workflow, append a single JSONL entry:

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","skill":"Remotion","workflow":"WORKFLOW_USED","input":"8_WORD_SUMMARY","status":"ok|error","duration_s":SECONDS}' >> ${NDEKO_DATA_DIR}/memory/SKILLS/execution.jsonl
```

Replace `WORKFLOW_USED` with the workflow executed, `8_WORD_SUMMARY` with a brief input description, and `SECONDS` with approximate wall-clock time. Log `status: "error"` if the workflow failed.
