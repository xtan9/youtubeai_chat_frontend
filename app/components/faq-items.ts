export type FaqItem = {
  question: string;
  answer: string;
};

export const faqItems: FaqItem[] = [
  {
    question: "What makes our YouTube AI Summarizer unique?",
    answer:
      "Two things most competitors miss. First, we work on videos without captions: when YouTube has no transcript, we transcribe the audio with Whisper and summarize anyway, instead of failing. Second, every summary comes with a chat tab — ask follow-up questions and get answers pulled straight from the full transcript, so you can drill into a specific moment without rewatching.",
  },
  {
    question: "Does our tool support multiple languages for video analysis?",
    answer:
      "Yes. We can transcribe videos in any language YouTube captions or Whisper covers, and you can pick the summary output from 18 supported languages — including English, Spanish, French, German, Portuguese, Chinese (Simplified and Traditional), Japanese, Korean, Arabic, Hindi, and more. A Japanese podcast can produce an English summary, or a Spanish keynote a Mandarin one.",
  },
  {
    question: "How does our AI handle technical or specialized content?",
    answer:
      "Summaries and chat are powered by Anthropic's Claude — a frontier LLM that handles specialized terminology across academic, technical, business, and creative domains. We don't strip out jargon: we work straight from the full transcript, so technical talks, research lectures, and code-heavy tutorials keep their nuance instead of getting flattened.",
  },
  {
    question: "Can I ask follow-up questions about a video?",
    answer:
      "Yes. Every summary has a Chat tab where you can ask anything and get an answer pulled straight from the transcript — clarify a concept, find a specific moment, or compare what two speakers said. Suggested follow-up prompts surface as you go so you can dig deeper without having to know what to ask.",
  },
  {
    question: "What's free, and what's in the Pro tier?",
    answer:
      "You can summarize one video with no signup, just to try it. Free signed-in accounts get 10 summaries per month and 5 chat messages per video. Pro is $4.99/month (billed yearly) or $6.99/month and unlocks unlimited summaries and unlimited chat. No credit card required for the free tier.",
  },
  {
    question: "Are my summaries saved?",
    answer:
      "If you're signed in, yes — every summary lands in your dashboard with the full transcript, the AI summary, and any chat history you had with it. You can revisit, re-chat, or share a direct link to any past result.",
  },
];
