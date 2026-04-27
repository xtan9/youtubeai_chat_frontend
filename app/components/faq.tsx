"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { MailIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { faqItems } from "./faq-items";

export function FAQ() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Mount after hydration to prevent mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Safe theme detection
  const isDarkMode = mounted && resolvedTheme === "dark";

  // Theme-specific styles
  const cardBg = isDarkMode ? "bg-white/5" : "bg-white";
  const cardBorder = isDarkMode ? "border-white/10" : "border-gray-100";
  const answerText = isDarkMode ? "text-gray-300" : "text-gray-700";
  const supportText = isDarkMode ? "text-gray-400" : "text-gray-600";
  const hoverBg = isDarkMode ? "hover:bg-white/5" : "hover:bg-gray-50";
  const itemBorder = isDarkMode ? "border-white/10" : "border-gray-200";

  return (
    <section className="w-full max-w-6xl mx-auto py-20">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold">Common Questions</h2>
      </div>

      <div
        className={`${cardBg} backdrop-blur-sm border ${cardBorder} rounded-xl overflow-hidden shadow-sm`}
      >
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
              className={itemBorder}
            >
              <AccordionTrigger
                className={`py-6 px-6 hover:no-underline ${hoverBg}`}
              >
                <h3 className="text-lg font-medium text-left">
                  {item.question}
                </h3>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6 pt-2">
                <p className={`${answerText} font-medium`}>{item.answer}</p>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      <div className="text-center mt-12">
        <p className={supportText + " mb-6"}>Need more information?</p>
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
