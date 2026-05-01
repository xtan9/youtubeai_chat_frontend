// Wraps the shared HOW_IT_WORKS_STEPS data in HowTo JSON-LD so the
// schema and the visible component (`app/components/how-it-works.tsx`)
// can never drift. Eligible for HowTo rich results in SERPs.
import { HOW_IT_WORKS_STEPS } from "@/app/components/how-it-works-steps";

export function buildHowToSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to Summarize a YouTube Video with AI",
    description:
      "Summarize and chat with any YouTube video in five steps: paste a link, run the analysis, let the system process the audio and transcript, get the structured summary, and ask follow-up questions in the chat tab.",
    totalTime: "PT2M",
    step: HOW_IT_WORKS_STEPS.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.title,
      text: s.body,
    })),
  };
}
