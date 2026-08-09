import type { Metadata } from "next";
import { BillingSuccessView } from "./BillingSuccessView";
import { isStripeCheckoutSessionId } from "@/lib/billing/checkout-return";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type BillingSuccessPageProps = {
  searchParams: Promise<{
    session_id?: string | string[];
  }>;
};

export default async function BillingSuccessPage({
  searchParams,
}: BillingSuccessPageProps) {
  const { session_id: sessionIdParam } = await searchParams;
  const sessionId =
    typeof sessionIdParam === "string" &&
    isStripeCheckoutSessionId(sessionIdParam.trim())
      ? sessionIdParam.trim()
      : null;

  return (
    <BillingSuccessView
      key={sessionId ?? "missing-checkout-session"}
      sessionId={sessionId}
    />
  );
}
