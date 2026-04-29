---
name: generate-faq
description: Use when the user wants to add a single FAQ entry to /faq. Produces an MDX file in content/faq/ with frontmatter validated by lib/content/faq.ts. The answer must be grounded in real product behavior — read the relevant codebase area before drafting.
---

# Generate a YouTubeAI FAQ Entry

You are drafting one FAQ entry for the `/faq` page. The entry lands in `content/faq/<slug>.mdx` and is rendered (grouped by category) on `/faq` and surfaced via FAQPage JSON-LD for AEO. Frontmatter is validated by `lib/content/faq.ts`.

## The non-negotiable rule

**FAQ answers must reference actual product behavior, not generic platitudes.** Before writing the answer, read the relevant codebase area for the category. Specifically:

- `pricing` → check `app/`, `components/`, and route files for paywall / billing logic. Verify against current state — don't paraphrase yesterday's answer.
- `accuracy` → read `youtube-ai-service/src/lib/captions.ts` and `whisper.ts` for the transcript pipeline; understand the captions-first / Whisper-fallback flow.
- `privacy` → read `app/privacy/page.tsx`, the auth flow, and any storage code. Match the live policy.
- `features` → read `app/page.tsx`, `app/summary/`, `app/components/` to know what features actually exist.
- `troubleshooting` → read error paths in API routes (`app/api/`) and known failure modes documented in code comments.

If the answer requires a claim you can't verify by reading the code, ask the user before guessing.

## Inputs

- **Question** (the user's input — refine for clarity, keep close to original phrasing)
- **Category** (one of: `pricing | accuracy | privacy | features | troubleshooting`)
- **Optional:** related blog post slugs

## Workflow you must follow

1. **Read the relevant codebase area** for the category (see list above).
2. **Refine the question.** Make it match how a user would search for it. Capitalize properly. Avoid jargon.
3. **Pick a slug.** Filename is `<slug>.mdx`. Slug is lowercase, hyphenated, 2–5 tokens, descriptive of the question's substance (not the answer).
4. **Draft the answer against TEMPLATE.mdx.** Length target: 60–180 words. Plain markdown allowed; lists OK; no headings (the question is the heading).
5. **Validate frontmatter against the Zod schema.** Required: question (8–200 chars), category (enum), updatedAt (YYYY-MM-DD). Optional: order (within-category sort), relatedBlogSlugs.
6. **Set `draft: true`.** User flips to `false` after review.
7. **Write the file** to `content/faq/<slug>.mdx`.
8. **Report back** with: file path, word count, and a 3-bullet review checklist (factual accuracy against code, voice match, clarity).

## What you must NOT do

- Write generic platitudes that could appear on any AI tool's FAQ ("our advanced AI uses cutting-edge models…").
- Claim features that don't exist in the codebase. If something's "on the roadmap," say so.
- Reuse exact wording from the homepage `<FAQ />` component without checking that the underlying behavior matches.
- Include marketing CTAs in the answer body. The /faq page already has structure; the answer is the answer.

## Voice

Same plainspoken voice as the blog (see `../generate-blog-post/STYLE_GUIDE.md`). Specifically for FAQ:

- Lead with the direct answer (yes / no / it depends), then explain.
- "Yes, with two caveats" is better than burying the conclusion under the caveats.
- For "no" answers, name the workaround if there is one.

## Outputs

A single `.mdx` file in `content/faq/` plus a brief status report.
