import dynamic from "next/dynamic";
import { InputForm } from "./components/input-form";
import { AnonHomepageGate } from "./components/anon-homepage-gate";
import { Benefits } from "./components/benefits";
import { UseCases } from "./components/use-cases";
import { HowItWorks } from "./components/how-it-works";
import { Testimonials } from "./components/testimonials";
import { FAQ } from "./components/faq";
import { HeroSection } from "./components/hero-section";
import FaqJsonLd from "@/components/seo/faq-jsonld";
import { JsonLd } from "@/components/seo/json-ld";
import { buildHowToSchema } from "@/components/seo/howto-schema";

// Heavy widget — pulls react-markdown + the chat hooks/UI. Dynamic-import
// with `ssr: false` keeps the initial homepage chunk small and lets the
// widget hydrate after critical content. The skeleton matches the
// eventual three-column grid so the page doesn't shift on hydration.
const HeroDemo = dynamic(() => import("./components/hero-demo"), {
  ssr: false,
  loading: () => (
    <section className="mx-auto max-w-page px-4 mb-16 w-full">
      <div className="grid gap-6 lg:grid-cols-[3fr_3.5fr_3.5fr] min-h-[480px]">
        <div className="bg-surface-sunken animate-pulse rounded-xl" />
        <div className="bg-surface-sunken animate-pulse rounded-xl" />
        <div className="bg-surface-sunken animate-pulse rounded-xl" />
      </div>
    </section>
  ),
});

export default function Home() {
  return (
    <main className="flex flex-col items-center px-4">
      <HeroSection />

      <HeroDemo />

      <section className="w-full max-w-6xl mx-auto mb-4 text-center">
        <h2 className="text-h4 text-text-primary mb-1">
          Or try your own video
        </h2>
        <p className="text-body-sm text-text-muted">
          Paste any YouTube URL — we&apos;ll summarize and let you chat with it.
        </p>
      </section>

      <AnonHomepageGate />

      <section className="w-full max-w-6xl mx-auto mb-16">
        <InputForm />
      </section>

      <Benefits />
      <UseCases />
      <HowItWorks />
      <Testimonials />
      <FAQ />
      <FaqJsonLd />
      <JsonLd id="structured-data-howto" data={buildHowToSchema()} />
    </main>
  );
}
