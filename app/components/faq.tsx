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
      question: "What is YouTube Summary with AI?",
      answer:
        "YouTube Summary with AI is a free online tool that uses artificial intelligence to analyze YouTube videos and generate concise, accurate summaries of their content. It extracts key points and insights, allowing you to understand the main ideas without watching the entire video.",
    },
    {
      value: "item-2",
      question:
        "Can YouTube Summary with AI provide video transcripts in multiple languages?",
      answer:
        "Yes, our AI can generate transcripts and summaries in multiple languages. You can select your preferred language from the dropdown menu before generating the summary.",
    },
    {
      value: "item-3",
      question:
        "Is it possible for YouTube Summary to process videos in languages other than English?",
      answer:
        "Yes, our AI can understand and summarize videos in many languages. The quality may vary depending on the language, but we're continuously improving our multilingual capabilities.",
    },
    {
      value: "item-4",
      question: "Can I save the transcripts of YouTube Summary with AI?",
      answer:
        "Yes, you can easily copy and save the generated transcripts and summaries. Simply click the 'Copy' button next to the content you want to save, and then paste it into your preferred document or note-taking app.",
    },
    {
      value: "item-5",
      question: "Is YouTube Summary with AI a free service?",
      answer:
        "Yes, our basic YouTube summary service is completely free to use. We also offer premium features for users who need advanced capabilities or higher usage limits.",
    },
  ];

  return (
    <section className="w-full max-w-6xl mx-auto py-20">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold">Frequently Asked Questions</h2>
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
        <p className="text-gray-400 mb-6">Still have questions?</p>
        <Button
          asChild
          className="bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600"
        >
          <a href="mailto:support@youtubeai.chat">
            <MailIcon className="mr-2 h-4 w-4" />
            Contact Support
          </a>
        </Button>
      </div>
    </section>
  );
}
