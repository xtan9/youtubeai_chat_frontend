import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { PlanBillingView } from "./PlanBillingView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Plan & Billing - YouTube AI Chat",
  description: "Review your YouTube AI Chat plan, usage, and billing.",
  robots: { index: false, follow: false },
};

export default async function PlanBillingPage() {
  const principalResult = await resolveRequestPrincipal({ source: "account" });
  if (principalResult.kind === "unavailable") {
    throw new Error("Auth service temporarily unavailable.");
  }
  if (
    principalResult.kind === "missing" ||
    principalResult.principal.isAnonymous
  ) {
    redirect("/auth/login");
  }

  return <PlanBillingView />;
}
