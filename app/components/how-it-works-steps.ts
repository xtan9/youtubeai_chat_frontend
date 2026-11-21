import english from "@/i18n/messages/en.json";
// Single source of truth for the 5-step "How It Works" content.
// Both the visible UI (`how-it-works.tsx`) and the HowTo JSON-LD
// (`components/seo/howto-schema.ts`) import this. Google's HowTo
// rich-result guidance expects schema text to mirror what users
// actually see, so the two surfaces must not drift — a single
// constant enforces that mechanically.

export type HowItWorksStep = {
  title: string;
  body: string;
};

export const HOW_IT_WORKS_STEPS: readonly HowItWorksStep[] = english.home.steps;
