import english from "@/i18n/messages/en.json";
export type FaqItem = {
  question: string;
  answer: string;
  link?: {
    href: string;
    label: string;
  };
};

export const faqItems: FaqItem[] = english.home.faqItems;
