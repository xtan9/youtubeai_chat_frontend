"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { MailIcon } from "lucide-react";

export function FAQ() {
  const faqItems = [
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
        "We offer multiple export options to fit your workflow. Copy text directly to your clipboard, download as PDF or markdown, save to your account library, or share via direct link. Premium users can also access additional formats like structured JSON data and presentation-ready slides.",
    },
    {
      value: "item-5",
      question: "Are there usage limits on the free version?",
      answer:
        "Our free tier provides access to our core summarization features with reasonable daily usage limits. We offer this to ensure everyone can benefit from our technology. For power users, content creators, researchers, or businesses with higher volume needs, our premium plans provide expanded capabilities and priority processing.",
    },
  ];

  return (
    <section className="w-full max-w-6xl mx-auto py-20">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold">Common Questions</h2>
      </div>

      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden">
        <Accordion
          type="single"
          collapsible
          defaultValue="item-1"
          className="w-full"
        >
          {faqItems.map((item) => (
            <AccordionItem
              key={item.value}
              value={item.value}
              className="border-white/10"
            >
              <AccordionTrigger className="py-6 px-6 hover:no-underline hover:bg-white/5">
                <h3 className="text-lg font-medium text-left">
                  {item.question}
                </h3>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6 pt-2">
                <p className="text-gray-300">{item.answer}</p>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      <div className="text-center mt-12">
        <p className="text-gray-400 mb-6">Need more information?</p>
        <Button
          asChild
          className="bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600"
        >
          <a href="mailto:support@youtubeai.chat">
            <MailIcon className="mr-2 h-4 w-4" />
            Reach Our Support Team
          </a>
        </Button>
      </div>
    </section>
  );
}
