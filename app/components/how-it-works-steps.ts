// Single source of truth for the 5-step "How It Works" content.
// Both the visible UI (`how-it-works.tsx`) and the HowTo JSON-LD
// (`components/seo/howto-schema.ts`) import this. Google's HowTo
// rich-result guidance expects schema text to mirror what users
// actually see, so the two surfaces must not drift — a single
// constant enforces that mechanically.

export type HowItWorksStep = {
  title: string;
  body: string;
};

export const HOW_IT_WORKS_STEPS: readonly HowItWorksStep[] = [
  {
    title: "Drop Your Video Link",
    body: "Paste the URL of any public YouTube video — short clips, two-hour podcasts, lectures, keynotes. Length and topic don't matter.",
  },
  {
    title: "Hit Summarize",
    body: "One click, no settings to tune. Pick the output language if you want something other than English; otherwise we use a sensible default for your locale.",
  },
  {
    title: "We Pull the Transcript",
    body: "We grab YouTube's captions when they're available — that's the fast path. When the creator hasn't published captions, we fall back to downloading the audio and transcribing it with Whisper. Most summarizers fail on caption-less videos; we don't.",
  },
  {
    title: "Get Your Summary",
    body: "A structured breakdown with key points, themes, and clickable timestamps that jump the player to the moment cited. Copy any passage, save it to your dashboard, or share a link.",
  },
  {
    title: "Ask Follow-Up Questions",
    body: "Switch to the Chat tab and ask anything. Claude answers from the full transcript, with suggested follow-up prompts so you can dig deeper without re-watching.",
  },
] as const;
