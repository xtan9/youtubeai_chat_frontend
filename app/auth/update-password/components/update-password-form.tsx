"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { parseRecoveryFragment } from "@/lib/auth/recovery-redirect";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function UpdatePasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const tr = useTranslations("ui");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [needsGlobalSignOut, setNeedsGlobalSignOut] = useState(false);
  const [isGlobalSignOutLoading, setIsGlobalSignOutLoading] = useState(false);
  const router = useRouter();

  // Recovery emails redirect here with `#access_token=...&type=recovery` in
  // a hash fragment (Supabase's legacy implicit-grant flow). The
  // @supabase/ssr browser client is PKCE-configured and only auto-processes
  // `?code=` queries — implicit-grant hashes pass through untouched. We
  // extract the tokens ourselves and call setSession so the form has a
  // session to act against. Without this, updateUser fails for every
  // user clicking the recovery link, because they're authenticated at the
  // Supabase server level (the audit log shows the login event) but the
  // browser SDK never picked up the session.
  useEffect(() => {
    const tokens = parseRecoveryFragment(window.location.hash);
    if (!tokens) return;
    const supabase = createClient();
    void supabase.auth
      .setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      })
      .then(({ error: setErr }) => {
        if (setErr) {
          setError("invalidRecovery");
          return;
        }
        // Strip the fragment so a refresh doesn't try to re-set an already-
        // consumed token, and so the access token doesn't sit in browser
        // history any longer than needed.
        window.history.replaceState(null, "", window.location.pathname);
      });
  }, []);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);
    setNeedsGlobalSignOut(false);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      // Keep the recovery browser's new Remembered Session while ending every
      // older session. Unlike global sign-out, the `others` scope does not
      // clear this browser's session.
      let revokeError: { message: string; status?: number } | null = null;
      try {
        ({ error: revokeError } = await supabase.auth.signOut({ scope: "others" }));
      } catch (error: unknown) {
        console.error("[update-password] other-session signOut threw", {
          message: error instanceof Error ? error.message : String(error),
        });
        setNeedsGlobalSignOut(true);
        setError(
          tr("revokeFailed"),
        );
        return;
      }
      if (revokeError) {
        console.error("[update-password] other-session signOut failed", {
          status: revokeError.status ?? null,
          message: revokeError.message,
        });
        setNeedsGlobalSignOut(true);
        setError(
          tr("revokeFailed"),
        );
        return;
      }

      router.push("/");
    } catch (error: unknown) {
      console.error("[update-password] password recovery threw", {
        message: error instanceof Error ? error.message : String(error),
      });
      setError(error instanceof Error ? error.message : tr("genericError"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOutEverywhere = async () => {
    if (isGlobalSignOutLoading) return;
    const supabase = createClient();
    setIsGlobalSignOutLoading(true);
    setError(null);

    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
      if (signOutError) {
        console.error("[update-password] global signOut failed", {
          status: signOutError.status ?? null,
          message: signOutError.message,
        });
        setError(tr("globalSignoutFailed"));
        return;
      }
      router.push("/");
    } catch (error: unknown) {
      console.error("[update-password] global signOut threw", {
        message: error instanceof Error ? error.message : String(error),
      });
      setError(tr("globalSignoutFailed"));
    } finally {
      setIsGlobalSignOutLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{tr("resetTitle")}</CardTitle>
          <CardDescription>
            {tr("newPasswordInstructions")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleForgotPassword}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="password">{tr("newPassword")}</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={tr("newPassword")}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-accent-danger">
                  {error === "invalidRecovery" ? tr("invalidRecovery") : error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? tr("savingPassword") : tr("savePassword")}
              </Button>
              {needsGlobalSignOut ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full"
                  onClick={handleSignOutEverywhere}
                  disabled={isGlobalSignOutLoading}
                >
                  {isGlobalSignOutLoading ? tr("signingOutAll") : tr("signOutAll")}
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
