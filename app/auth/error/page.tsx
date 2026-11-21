import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Authentication Error - YouTube AI Chat",
  description: "An error occurred during authentication.",
  // Auth pages don't belong in the index — Disallow in robots.txt only
  // suppresses crawling, not indexing of externally-linked URLs.
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const tr = await getTranslations("ui");
  const params = await searchParams;

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                {tr("authFailure")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {params?.error ? (
                <p className="text-sm text-text-muted">
                  {tr("authErrorCode", {code: params.error})}
                </p>
              ) : (
                <p className="text-sm text-text-muted">
                  {tr("unknownAuthFailure")}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
