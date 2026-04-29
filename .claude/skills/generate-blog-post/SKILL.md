---
name: generate-blog-post
description: Use when the user wants to draft a blog post for the YouTubeAI blog. Produces a structured MDX file in content/blog/ with required real-video grounding, draft frontmatter, and the schema validated by lib/content/blog.ts.
---

# Generate a YouTubeAI Blog Post

You are drafting a blog post for the YouTubeAI marketing blog. The post lands in `content/blog/<YYYY-MM>-<slug>.mdx` and is rendered by `app/blog/[slug]/page.tsx`. Frontmatter is validated by `lib/content/blog.ts` — a missing required field will fail the build, so don't skip them.

## The non-negotiable rule

**A blog post must be grounded in a real anchor.** The anchor is what stops AI-generated content from being slop. Before drafting anything:

- For `category: workflows` — REQUIRED to have a real `heroVideo` (a specific YouTube URL the user has provided or you've fetched). The build will refuse the post otherwise.
- For `category: tutorials` — heroVideo strongly recommended (the tutorial walks through that video).
- For `category: comparisons` — anchor is the specific comparison being made (e.g., feature pair, competitor URL); cite it explicitly in the post body.
- For `category: news` — anchor is the source URL (release notes, blog post, official announcement); link it in the body.

If the user provides only a topic with no anchor, **ask for one before generating**. Do not invent video URLs, fabricate timestamps, or quote dialog you haven't actually verified.

## Inputs

The user invokes you with:
- **Topic / working title** (free-form)
- **YouTube URL** (required for workflows; recommended for tutorials)
- **Optional:** target keyword(s), category override, draft mode override

## Workflow you must follow

1. **Confirm the anchor.** If the user didn't provide a YouTube URL or other concrete anchor, stop and ask for one. Do not proceed with a generic topic.
2. **Research phase.** Read `app/components/faq.tsx`, `app/components/how-it-works.tsx`, and one existing post in `content/blog/` to align voice. If the anchor is a YouTube URL, optionally fetch the video page (title, channel, duration) to populate the `heroVideo` block accurately. If you cannot reach the page, ask the user for the title/channel rather than guessing.
3. **Pick the slug.** Filename pattern is `<YYYY-MM>-<slug>.mdx`. Slug is lowercase, hyphenated, no stop-words, 3–6 tokens. Example: `summarize-long-podcast`.
4. **Draft against TEMPLATE.mdx.** Follow the section structure exactly. Word target: 1200–1800 for substantive posts; 800–1200 for short evergreen pieces.
5. **Apply STYLE_GUIDE.md.** Voice rules, banned phrases, paragraph cadence.
6. **Apply GROUNDING_RULES.md.** What you may and may not claim about the example video.
7. **Validate frontmatter against the Zod schema.** Required fields: title, description (20–200 chars), publishedAt (YYYY-MM-DD), category. Optional but expected: heroVideo, faq (3–5 items), tags.
8. **Set `draft: true`** on the frontmatter. The user will flip to `false` after review. Drafts are excluded from the listing and sitemap.
9. **Write the file** to `content/blog/<YYYY-MM>-<slug>.mdx`. Do not run a build — leave verification to the user (or to CI on push).
10. **Report back** with: file path, word count, schema types that will emit on the post page, and a 5-bullet review checklist (factual claims to verify, hallucination risk, voice match, internal links, CTA wired via heroVideo).

## What you must NOT do

- Invent specific video timestamps you can't verify.
- Quote dialog or claims you haven't actually heard / read.
- Fabricate statistics, study citations, or quoted experts.
- Skip the FAQ block if the post has 3+ paragraphs of substance — it boosts AEO surface massively.
- Use "as an AI" / "I" / first-person — the byline is `YouTubeAI Team`.
- Use marketing fluff phrases listed in STYLE_GUIDE.md.

## Outputs

A single `.mdx` file in `content/blog/` plus a one-paragraph status report to the user. No extra files, no commits — the user owns the publish step.
