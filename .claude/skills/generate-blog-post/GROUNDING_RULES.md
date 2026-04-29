# Grounding rules — what you may and may not claim

These rules exist because hallucinated specifics in a post will eventually be discovered, and "AI-generated content with fabricated details" is a worse SEO outcome than "AI-generated content with cautious specifics."

## What you MAY claim about the example video

- The title and channel (if you've verified them by fetching the page or the user provided them).
- The duration (if you've verified it; otherwise omit `durationSec` from frontmatter).
- The general topic of the video (e.g., "an interview about AI safety" — broad strokes the title and description make obvious).
- The format (interview, tutorial, lecture, panel discussion).
- That the video has captions OR doesn't (you can determine this by fetching the watch page; if you haven't, don't claim).

## What you MUST NOT claim

- **Specific timestamps** ("at 1:23:45 the host says X"). You cannot verify these without watching the video.
- **Direct quotes** unless the user has provided the transcript and you're quoting from it verbatim.
- **Specific arguments or positions taken** ("the guest argues that X is better than Y"). The video description rarely covers this and you'd be inventing the substance.
- **Statistics or numbers cited in the video** unless they're in the title or description.
- **Names of people other than the host/guest visible in the metadata.**

## What to do when you'd otherwise need a specific you can't verify

Refer to the video at the level of *workflow* not *content*. Examples:

- ❌ "At minute 43, Karpathy says…" → ✅ "When the conversation turns to backpropagation, the summary surfaces…"
- ❌ "The video shows three benchmarks: A, B, C" → ✅ "The video walks through the benchmarks visually, which the transcript captures as named references but not as the visualizations themselves"
- ❌ "Lex asks Karpathy about consciousness in chapter 4" → ✅ "The interview covers a range of topics including AI safety and the practical limits of current systems"

## What to do when the user requests specifics you can't verify

If the user says "include the part where the host argues X," push back: ask whether they've watched the video and can confirm the claim, or whether they want you to omit the specific and stay at the workflow level. Do NOT fabricate to satisfy the request.

## Verifying URLs

When you receive a YouTube URL:

1. Extract the video ID (11 characters in `?v=` or after `youtu.be/`).
2. Optionally fetch `https://www.youtube.com/watch?v=<id>` to check the title and channel. The page reliably exposes the og:title and og:description meta tags.
3. If the page returns a 404 or shows a private/removed indicator, stop and tell the user. Don't paper over it.

## When in doubt, omit

A post with fewer specifics is better than a post with fabricated specifics. The grounding is the URL itself — the reader can run the tool against it. That's the proof of concept; the post body doesn't need to also pretend to be a viewing report.
