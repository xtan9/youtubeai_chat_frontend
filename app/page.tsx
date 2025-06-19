"use client";

import { InputForm } from "./components/input-form";
import { Benefits } from "./components/benefits";
import { UseCases } from "./components/use-cases";
import { HowItWorks } from "./components/how-it-works";
import { Testimonials } from "./components/testimonials";
import { FAQ } from "./components/faq";
import { HeroSection } from "./components/hero-section";

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
    </main>
  );
}
