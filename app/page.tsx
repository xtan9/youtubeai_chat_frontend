import { InputForm } from "./components/input-form";
import { Benefits } from "./components/benefits";
import { UseCases } from "./components/use-cases";
import { HowItWorks } from "./components/how-it-works";
import { Testimonials } from "./components/testimonials";
import { FAQ } from "./components/faq";
import { HeroSection } from "./components/hero-section";
import FaqJsonLd from "@/components/seo/faq-jsonld";
import { JsonLd } from "@/components/seo/json-ld";
import { buildHowToSchema } from "@/components/seo/howto-schema";

export default function Home() {
  return (
    <main className="flex flex-col items-center px-4">
      <HeroSection />

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
