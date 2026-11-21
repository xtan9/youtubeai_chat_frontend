import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign Up Success - YouTube AI Chat",
  description: "Confirm your email to finish creating your YouTube AI Chat account.",
  // Auth pages don't belong in the index — Disallow in robots.txt only
  // suppresses crawling, not indexing of externally-linked URLs.
  robots: { index: false, follow: false },
};

export default async function Page() {
  const tr = await getTranslations("ui");
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <h1 className="text-2xl font-semibold leading-none">
                {tr("signupThanks")}
              </h1>
              <CardDescription>{tr("confirmEmail")}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-text-muted">
                {tr("confirmInstructions")}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
