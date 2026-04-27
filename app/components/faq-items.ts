export type FaqItem = {
  value: string;
  question: string;
  answer: string;
};

export const faqItems: FaqItem[] = [
  {
    value: "item-1",
    question: "What makes our YouTube AI Summarizer unique?",
    answer:
      "Our platform combines advanced natural language processing with specialized video content analysis to deliver more than just transcripts. We extract meaningful insights, identify key themes, and structure information in a way that maximizes comprehension and retention—all with unmatched accuracy and speed.",
  },
  {
    value: "item-2",
    question: "Does our tool support multiple languages for video analysis?",
    answer:
      "Absolutely! Our AI system can process videos in over 30 languages with high accuracy. You can also choose to receive your summary in a different language than the original video, making it perfect for international research and learning.",
  },
  {
    value: "item-3",
    question: "How does our AI handle technical or specialized content?",
    answer:
      "We've trained our models on diverse datasets across academic, technical, business, and entertainment domains. This allows our system to recognize specialized terminology, understand complex concepts, and accurately summarize even highly technical videos with proper context.",
  },
  {
    value: "item-4",
    question: "What formats can I export my video summaries in?",
    answer:
      "We offer multiple export options to fit your workflow. You can copy text directly to your clipboard, download as PDF or markdown, save to your account library, or share via direct link. All these features are available completely free of charge.",
  },
  {
    value: "item-5",
    question: "Is this service really 100% free?",
    answer:
      "Yes! Our service is completely free with no hidden costs or premium tiers. We believe in making AI-powered video analysis accessible to everyone. You get full access to all features without any paywalls or usage restrictions.",
  },
];
