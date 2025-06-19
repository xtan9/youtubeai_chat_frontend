"use client";

import { InputForm } from "./components/input-form";
import { Benefits } from "./components/benefits";
import { UseCases } from "./components/use-cases";
import { HowItWorks } from "./components/how-it-works";
import { Testimonials } from "./components/testimonials";
import { FAQ } from "./components/faq";

export default function Home() {
  return (
    <main className="flex flex-col items-center px-4">
      <InputForm />
      <Benefits />
      <UseCases />
      <HowItWorks />
      <Testimonials />
      <FAQ />
    </main>
  );
}
