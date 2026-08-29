# YouTube Extraction Workflow

Extract content from YouTube videos using Fabric CLI. Automatically downloads, transcribes, and processes video content with optional pattern application for analysis and summarization.

## When to Activate This Skill
- Extract content from YouTube video
- Get YouTube transcript
- Analyze YouTube video
- Summarize YouTube content
- Process YouTube video text

## The Command

Extract content from any YouTube video:

```bash
yt-dlp --skip-download --write-auto-subs --sub-format vtt -o transcript "YOUTUBE_URL"
```

## With Pattern Processing

Process extracted content through Fabric pattern:

```bash
yt-dlp --skip-download --write-auto-subs --sub-format vtt -o transcript "YOUTUBE_URL"   # then read transcript.*.vtt
```

## Critical Facts

- **NEVER** use yt-dlp or youtube-dl
- **NEVER** use web scraping for YouTube
- **NEVER** use transcription APIs directly
- **Fabric handles everything**: Download, transcription, extraction automatically
- **Output**: Clean text content from video

## Common Patterns

- `extract_wisdom` - Extract key insights
- `summarize` - Create concise summary
- `extract_main_idea` - Get core message
- `create_summary` - Detailed summary

## Example Usage

```bash
# Extract raw content
yt-dlp --skip-download --write-auto-subs --sub-format vtt -o t "https://www.youtube.com/watch?v=VIDEO_ID"

# Extract wisdom
yt-dlp --skip-download --write-auto-subs --sub-format vtt -o t "https://www.youtube.com/watch?v=VIDEO_ID"

# Summarize video
yt-dlp --skip-download --write-auto-subs --sub-format vtt -o t "https://www.youtube.com/watch?v=VIDEO_ID"
```

## How It Works
1. Fabric downloads video
2. Fabric extracts audio
3. Fabric transcribes audio
4. Fabric returns clean text
5. If pattern specified, processes through pattern

## Supplementary Resources
`fabric` is not installed in this harness — transcripts come from `yt-dlp` and the summarizing/extraction step is done by the model reading the VTT. *(Repointed 2026-08-19.)*
