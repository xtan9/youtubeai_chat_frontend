"use client";

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
import { useRouter } from "next/navigation";
import { useState } from "react";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import {
  buildAuthCallbackUrl,
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    if (password !== repeatPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    try {
      const next = getSafeAuthRedirect(window.location.href);
      const emailRedirectTo = buildAuthCallbackUrl(window.location.origin, next);
      const currentUser = await supabase.auth.getUser();
      if (currentUser.error && !isMissingAuthSession(currentUser.error)) {
        throw currentUser.error;
      }

      const preservesAnonymousIdentity = currentUser.data.user?.is_anonymous === true;
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
      }
      router.push(
        !preservesAnonymousIdentity && immediateSession
          ? next
          : "/auth/sign-up-success",
      );
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
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
          ),
        },
      } as const;
      const { error } = currentUser.data.user?.is_anonymous
        ? await supabase.auth.linkIdentity(credentials)
        : await supabase.auth.signInWithOAuth(credentials);
      if (error) {
        // Better error message for OAuth configuration issues
        if (error.message.includes("provider") || error.message.includes("OAuth")) {
          throw new Error("Google sign-in is not configured. Please contact support or use email sign-up.");
        }
        throw error;
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold leading-none">Sign up</h1>
          <CardDescription>Create a new account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
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
                  <Label htmlFor="password">Password</Label>
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
                  <Label htmlFor="repeat-password">Repeat Password</Label>
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
                {isLoading ? "Creating an account..." : "Sign up"}
              </Button>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-surface-base px-2 text-text-muted">
                    Or continue with
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
              Already have an account?{" "}
              <Link href="/auth/login" className="underline underline-offset-4">
                Login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
