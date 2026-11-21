"use client";

import {useTranslations} from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProfileAvatar } from "@/components/profile-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useUser } from "@/lib/contexts/user-context";
import { createClient } from "@/lib/supabase/client";

export function AccountView() {
  const t = useTranslations("ui");
  const { user } = useUser();
  const router = useRouter();
  const supabase = createClient();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [activeSignOutScope, setActiveSignOutScope] = useState<
    "local" | "global" | null
  >(null);

  if (!user) return null;

  const displayName =
    user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? t("accountUser");

  const handleSignOut = async () => {
    if (activeSignOutScope) return;
    setSignOutError(null);
    setActiveSignOutScope("local");

    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        console.error("[account] local signOut failed", {
          status: error.status ?? null,
          message: error.message,
        });
        setSignOutError(
          "couldntSignYouOutCheckYourConnectionAndTryAgain",
        );
        return;
      }
      router.push("/");
    } catch (error: unknown) {
      console.error("[account] local signOut threw", {
        message: error instanceof Error ? error.message : String(error),
      });
      setSignOutError(
        "couldntSignYouOutCheckYourConnectionAndTryAgain",
      );
    } finally {
      setActiveSignOutScope(null);
    }
  };

  const handleSignOutEverywhere = async () => {
    if (activeSignOutScope) return;
    setSignOutError(null);
    setActiveSignOutScope("global");

    try {
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) {
        console.error("[account] global signOut failed", {
          status: error.status ?? null,
          message: error.message,
        });
        setSignOutError(
          "revokeUnconfirmed",
        );
        return;
      }
      router.push("/");
    } catch (error: unknown) {
      console.error("[account] global signOut threw", {
        message: error instanceof Error ? error.message : String(error),
      });
      setSignOutError(
        "revokeUnconfirmed",
      );
    } finally {
      setActiveSignOutScope(null);
    }
  };

  return (
    <main className="mx-auto max-w-page px-6 py-8">
      <div className="mx-auto flex max-w-prose flex-col gap-6">
        <h1 className="text-h2 text-text-primary">{t("account")}</h1>

        <Card>
          <CardContent className="flex items-center gap-4">
            <ProfileAvatar user={user} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-body-lg font-semibold text-text-primary">
                {displayName}
              </span>
              <span className="truncate text-body-sm text-text-muted">
                {user.email}
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col items-start gap-3">
          {signOutError ? (
            <p
              role="alert"
              aria-live="assertive"
              className="text-body-sm text-accent-danger"
            >
              {t(signOutError)}
            </p>
          ) : null}
          <Button
            variant="outline"
            onClick={handleSignOut}
            disabled={activeSignOutScope !== null}
          >
            {activeSignOutScope === "local" ? t("signingOut") : t("signOut")}
          </Button>
          <div className="flex flex-col items-start gap-2">
            <Button
              variant="destructive"
              onClick={handleSignOutEverywhere}
              disabled={activeSignOutScope !== null}
            >
              {activeSignOutScope === "global"
                ? t("signingOutAll")
                : t("signOutAll")}
            </Button>
            <p className="max-w-prose text-body-sm text-text-muted">
              {t("revokeInfo")}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
