import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "./components/forgot-password-form";
import type { Metadata } from "next";
import { Suspense } from "react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publicPages");
  return {
    title: t("forgot-passwordTitle"),
    description: t("forgot-passwordTitleDesc"),
    // Auth pages don't belong in the index — Disallow in robots.txt only
    // suppresses crawling, not indexing of externally-linked URLs.
    robots: { index: false, follow: false },
  };
}

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense>
          <ForgotPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
