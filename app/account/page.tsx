import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { AccountView } from "./AccountView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account - YouTube AI Chat",
  description: "Manage your YouTube AI Chat identity and session security.",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
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
  return <AccountView />;
}
