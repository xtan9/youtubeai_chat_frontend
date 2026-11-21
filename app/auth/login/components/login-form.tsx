"use client";

import {useTranslations} from "next-intl";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  buildAuthCallbackUrl,
  buildAuthPageHref,
  getSafeAuthRedirect,
} from "@/lib/auth/signup-redirect";
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

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const tr = useTranslations("ui");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const redirectTo = useSearchParams().get("redirect_to");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      router.push(getSafeAuthRedirect(window.location.href));
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : tr("genericError"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: buildAuthCallbackUrl(
            window.location.origin,
            getSafeAuthRedirect(window.location.href),
          ),
        },
      });
      if (error) {
        // Better error message for OAuth configuration issues
        if (
          error.message.includes("provider") ||
          error.message.includes("OAuth")
        ) {
          throw new Error(
            tr("googleLogin")
          );
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
          <h1 className="text-2xl font-semibold leading-none">{tr("login")}</h1>
          <CardDescription>
            {tr("loginDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin}>
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
                  <Link
                    href={buildAuthPageHref("/auth/forgot-password", redirectTo)}
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    {tr("forgot")}
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-accent-danger">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? tr("loggingIn") : tr("login")}
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
                onClick={handleGoogleLogin}
                disabled={isLoading}
              >
                <GoogleIcon className="mr-2" />
                Google
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              {tr("noAccount")}{" "}
              <Link
                href={buildAuthPageHref("/auth/sign-up", redirectTo)}
                className="underline underline-offset-4"
              >
                {tr("signUp")}
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
