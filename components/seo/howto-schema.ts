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
    text: "Find any YouTube video you want to analyze and copy the URL. Our system works with any public video regardless of length or complexity.",
  },
  {
    name: "Activate AI Analysis",
    text: "Hit the summarize button and watch our advanced AI engine spring into action. No configuration needed—we've optimized the settings for you.",
  },
  {
    name: "Smart Processing Begins",
    text: "Our system downloads the video, extracts the audio, transcribes the content in 30+ languages, and applies natural language processing to identify key themes and insights.",
  },
  {
    name: "Get Your Summary",
    text: "Receive a structured breakdown with key points, themes, and clickable timestamps. Copy any passage, save it to your library, or share a link to the result.",
  },
  {
    name: "Ask Follow-Up Questions",
    text: "Switch to the Chat tab and ask anything about the video. The AI answers from the transcript, with suggested follow-up prompts so you can dig deeper without re-watching.",
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
