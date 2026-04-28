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

  // Mount after hydration to prevent mismatch.
  // TODO(B-followup): move to useSyncExternalStore against
  // `next-themes`'s resolvedTheme + a media-query subscription so the
  // hydration-only flag is no longer needed. Keeping the legacy
  // pattern for now; cluster scope is composites, not marketing
  // surface refactor.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    <section id="faq" className="w-full max-w-6xl mx-auto py-20 scroll-mt-24">
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
          {faqItems.map((item, index) => {
            const value = `item-${index + 1}`;
            return (
              <AccordionItem
                key={value}
                value={value}
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
            );
          })}
        </Accordion>
      </div>

      <div className="text-center mt-12">
        <p className={supportText + " mb-6"}>Need more information?</p>
        <Button
          asChild
          className="bg-gradient-brand-primary hover:bg-gradient-brand-primary-hover"
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
