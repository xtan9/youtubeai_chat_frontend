// Mirrors the visible 5-step content in app/components/how-it-works.tsx so
// the schema and the rendered UI stay in sync. Eligible for HowTo rich
// results in SERPs.
type HowToStep = {
  name: string;
  text: string;
};

const STEPS: HowToStep[] = [
  {
    name: "Drop Your Video Link",
    text: "Paste the URL of any public YouTube video — short clips, two-hour podcasts, lectures, keynotes. Length and topic don't matter.",
  },
  {
    name: "Hit Summarize",
    text: "One click, no settings to tune. Pick the output language if you want something other than English; otherwise we use a sensible default for your locale.",
  },
  {
    name: "We Pull the Transcript",
    text: "We grab YouTube's captions when they're available. When the creator hasn't published captions, we fall back to downloading the audio and transcribing it with Whisper, so caption-less videos still work.",
  },
  {
    name: "Get Your Summary",
    text: "A structured breakdown with key points, themes, and clickable timestamps that jump the player to the moment cited. Copy any passage, save it to your dashboard, or share a link.",
  },
  {
    name: "Ask Follow-Up Questions",
    text: "Switch to the Chat tab and ask anything. Claude answers from the full transcript, with suggested follow-up prompts so you can dig deeper without re-watching.",
  },
];

export function buildHowToSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to Summarize a YouTube Video with AI",
    description:
      "Summarize and chat with any YouTube video in five steps: paste a link, run the analysis, let the system process the audio and transcript, get the structured summary, and ask follow-up questions in the chat tab.",
    totalTime: "PT2M",
    step: STEPS.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}
