export type FaqItem = {
  question: string;
  answer: string;
};

export const faqItems: FaqItem[] = [
  {
    question: "What makes our YouTube AI Summarizer unique?",
    answer:
      "Our platform combines advanced natural language processing with specialized video content analysis to deliver more than just transcripts. We extract meaningful insights, identify key themes, and structure information in a way that maximizes comprehension and retention—all with unmatched accuracy and speed.",
  },
  {
    question: "Does our tool support multiple languages for video analysis?",
    answer:
      "Absolutely! Our AI system can process videos in over 30 languages with high accuracy. You can also choose to receive your summary in a different language than the original video, making it perfect for international research and learning.",
  },
  {
    question: "How does our AI handle technical or specialized content?",
    answer:
      "We've trained our models on diverse datasets across academic, technical, business, and entertainment domains. This allows our system to recognize specialized terminology, understand complex concepts, and accurately summarize even highly technical videos with proper context.",
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
