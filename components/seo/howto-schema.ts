// Mirrors the visible 4-step content in app/components/how-it-works.tsx so
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
    text: "Our system downloads the video, extracts the audio, transcribes the content, and applies natural language processing to identify key themes and insights.",
  },
  {
    name: "Explore Your Results",
    text: "Receive a comprehensive breakdown with key points, timestamps, and thematic analysis. Share, save, or export your results in multiple formats.",
  },
];

export function buildHowToSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to Summarize a YouTube Video with AI",
    description:
      "Generate an AI summary of any YouTube video in four steps: paste a link, run the analysis, let the system process the audio and transcript, and explore the structured results.",
    totalTime: "PT2M",
    step: STEPS.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}
