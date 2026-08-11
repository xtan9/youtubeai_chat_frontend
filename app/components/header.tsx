"use client";

import Link from "next/link";
import {
  CreditCard,
  FolderKanban,
  LogOut,
  User as UserIcon,
} from "lucide-react";
import { YtAiMark } from "@/components/brand/yt-ai-mark";
import { Button } from "@/components/ui/button";
import { ProfileAvatar } from "@/components/profile-avatar";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { HeaderPlanControl } from "./header-plan-control";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/lib/contexts/user-context";
import { Suspense, useState } from "react";
import { CheckoutActivationGuard } from "./checkout-activation-guard";

export function Header() {
  const { error: authError, isLoading: isAuthLoading, user } = useUser();
  const router = useRouter();
  const supabase = createClient();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setSignOutError(null);
    setIsSigningOut(true);

    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        console.error("[header] signOut failed", {
          status: error.status ?? null,
          message: error.message,
        });
        setSignOutError("Couldn't sign you out. Check your connection and try again.");
        return;
      }
      // Force a document navigation so an authenticated App Router prefetch of
      // `/` cannot reuse its cached `/dashboard` redirect after sign-out.
      window.location.replace("/");
    } catch (error: unknown) {
      console.error("[header] signOut threw", {
        message: error instanceof Error ? error.message : String(error),
      });
      setSignOutError("Couldn't sign you out. Check your connection and try again.");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <header className="w-full border-b border-border-subtle bg-surface-base/95 backdrop-blur-md dark:bg-gradient-to-r dark:from-gray-900/95 dark:to-black/95">
      <div className="mx-auto max-w-page px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link
              href="/"
              aria-label="YouTube AI Chat home"
              className="group flex items-center gap-2 sm:gap-3"
            >
              <div className="flex size-9 transform items-center justify-center rounded-xl bg-gradient-brand-primary transition-transform group-hover:scale-110 sm:size-10">
                <YtAiMark className="w-7 h-7 text-white" />
              </div>
              <span className="hidden bg-gradient-brand-primary bg-clip-text text-xl font-bold text-transparent sm:inline">
                YouTube AI Chat
              </span>
            </Link>

            <nav
              aria-label="Primary"
              className="hidden md:flex items-center gap-6 text-body-sm font-medium"
            >
              {user && !user.is_anonymous ? (
                <Link
                  href="/workspace"
                  className="text-text-muted hover:text-text-primary transition-colors"
                >
                  Workspace
                </Link>
              ) : null}
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <ThemeSwitcher />
            <Suspense
              fallback={
                <HeaderPlanControl
                  user={null}
                  isAuthLoading
                  authError={false}
                />
              }
            >
              <CheckoutActivationGuard>
                <HeaderPlanControl
                  user={user}
                  isAuthLoading={isAuthLoading}
                  authError={authError !== null}
                />
              </CheckoutActivationGuard>
            </Suspense>

            {/* Authentication Status and Actions */}
            {!user || user.is_anonymous ? (
              <div className="flex items-center">
                <Button
                  onClick={() => router.push("/auth/login")}
                  className="rounded-full bg-gradient-brand-primary px-4 text-white hover:bg-gradient-brand-primary-hover sm:px-6"
                >
                  Sign In
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-brand"
                      aria-label="User menu"
                    >
                      <ProfileAvatar user={user} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuItem asChild>
                      <Link
                        href="/workspace"
                        className="cursor-pointer flex items-center gap-2"
                      >
                        <FolderKanban size={16} />
                        <span>Workspace</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        href="/account"
                        className="cursor-pointer flex items-center gap-2"
                      >
                        <UserIcon size={16} />
                        <span>Account</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        href="/account/billing"
                        className="cursor-pointer flex items-center gap-2"
                      >
                        <CreditCard size={16} />
                        <span>Plan &amp; Billing</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={handleSignOut}
                      disabled={isSigningOut}
                      className="cursor-pointer"
                    >
                      <LogOut size={16} />
                      <span>{isSigningOut ? "Signing out…" : "Sign Out"}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>
        {signOutError ? (
          <p
            role="alert"
            aria-live="assertive"
            className="mt-3 text-body-sm text-accent-danger"
          >
            {signOutError}
          </p>
        ) : null}
      </div>
    </header>
  );
}
