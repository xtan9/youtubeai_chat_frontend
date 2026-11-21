"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { buildRecoveryRedirectUrl } from "@/lib/auth/recovery-redirect";
import { buildAuthPageHref } from "@/lib/auth/signup-redirect";
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
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

export function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const tr = useTranslations("ui");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const redirectTo = useSearchParams().get("redirect_to");

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      // redirectTo is canonicalized via buildRecoveryRedirectUrl so the
      // recovery email link lands users on the update-password form.
      // See lib/auth/recovery-redirect.ts for the allowlist + implicit-grant
      // reasoning.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: buildRecoveryRedirectUrl(window.location.origin),
      });
      if (error) throw error;
      setSuccess(true);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : tr("genericError"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      {success ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{tr("checkMail")}</CardTitle>
            <CardDescription>{tr("resetSent")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-muted">
              {tr("resetNotice")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{tr("resetTitle")}</CardTitle>
            <CardDescription>
              {tr("resetInstructions")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleForgotPassword}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="email">{tr("email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="m@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {error && <p className="text-sm text-accent-danger">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? tr("sending") : tr("sendReset")}
                </Button>
              </div>
              <div className="mt-4 text-center text-sm">
                {tr("haveAccount")}{" "}
                <Link
                  href={buildAuthPageHref("/auth/login", redirectTo)}
                  className="underline underline-offset-4"
                >
                  {tr("login")}
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
