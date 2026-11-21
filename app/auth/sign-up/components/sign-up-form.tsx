"use client";

import {useTranslations} from "next-intl";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleIcon } from "@/components/ui/google-icon";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import {
  buildAuthCallbackUrl,
  buildAuthPageHref,
  getSafeAuthRedirect,
} from "@/lib/auth/signup-redirect";

function isMissingAuthSession(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AuthSessionMissingError" ||
      "code" in error && error.code === "session_not_found")
  );
}

export function SignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const tr = useTranslations("ui");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const redirectTo = useSearchParams().get("redirect_to");

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    if (password !== repeatPassword) {
      setError(tr("passwordMismatch"));
      setIsLoading(false);
      return;
    }

    try {
      const next = getSafeAuthRedirect(window.location.href);
      const currentUser = await supabase.auth.getUser();
      if (currentUser.error && !isMissingAuthSession(currentUser.error)) {
        throw currentUser.error;
      }

      const preservesAnonymousIdentity = currentUser.data.user?.is_anonymous === true;
      const emailRedirectTo = buildAuthCallbackUrl(
        window.location.origin,
        next,
        preservesAnonymousIdentity ? "email" : undefined,
      );
      const { data, error } = preservesAnonymousIdentity
        ? await supabase.auth.updateUser(
            { email, password },
            { emailRedirectTo },
          )
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo },
      });
      if (error) throw error;
      const immediateSession = "session" in data ? data.session : null;
      // Supabase can return an obfuscated user for an already-registered
      // address when email enumeration protection is enabled. A real identity
      // is the authoritative signal that this request created an account.
      if ((data.user?.identities?.length ?? 0) > 0) {
        captureAnalyticsEvent("signup_completed", {
          auth_method: "email",
          email_confirmation_required: !immediateSession,
          source_surface: "sign_up_form",
        });
        if (preservesAnonymousIdentity && data.user?.is_anonymous === false) {
          captureAnalyticsEvent("anonymous_trial_converted", {
            source_surface: "hero_demo",
            registration_method: "email",
          });
        }
      }
      router.push(
        !preservesAnonymousIdentity && immediateSession
          ? next
          : "/auth/sign-up-success",
      );
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : tr("genericError"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const currentUser = await supabase.auth.getUser();
      if (currentUser.error && !isMissingAuthSession(currentUser.error)) {
        throw currentUser.error;
      }
      const credentials = {
        provider: "google",
        options: {
          redirectTo: buildAuthCallbackUrl(
            window.location.origin,
            getSafeAuthRedirect(window.location.href),
            currentUser.data.user?.is_anonymous ? "google" : undefined,
          ),
        },
      } as const;
      const { error } = currentUser.data.user?.is_anonymous
        ? await supabase.auth.linkIdentity(credentials)
        : await supabase.auth.signInWithOAuth(credentials);
      if (error) {
        // Better error message for OAuth configuration issues
        if (error.message.includes("provider") || error.message.includes("OAuth")) {
          throw new Error(tr("googleSignup"));
        }
        throw error;
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : tr("genericError"));
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold leading-none">{tr("signUp")}</h1>
          <CardDescription>{tr("newAccount")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp}>
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
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">{tr("password")}</Label>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="repeat-password">{tr("repeatPassword")}</Label>
                </div>
                <Input
                  id="repeat-password"
                  type="password"
                  required
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-accent-danger">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? tr("creatingAccount") : tr("signUp")}
              </Button>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-surface-base px-2 text-text-muted">
                    {tr("orContinue")}
                  </span>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleGoogleSignUp}
                disabled={isLoading}
              >
                <GoogleIcon className="mr-2" />
                Google
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
    </div>
  );
}
