"use client";

import Link from "next/link";
import { Brain, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileAvatar } from "@/components/profile-avatar";
import { ThemeSwitcher } from "@/components/theme-switcher";
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
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import { ManageSubscriptionButton } from "@/components/paywall/ManageSubscriptionButton";

export function Header() {
  const { user } = useUser();
  const router = useRouter();
  const supabase = createClient();
  const { data: entitlements } = useEntitlements();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    // Navigate to home page
    router.push("/");
  };

  return (
    <header className="sticky top-0 w-full z-50 border-b border-border-subtle backdrop-blur-md bg-surface-base/95 dark:bg-gradient-to-r dark:from-gray-900/95 dark:to-black/95">
      <div className="mx-auto max-w-page px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 bg-gradient-brand-primary rounded-xl flex items-center justify-center transform group-hover:scale-110 transition-transform">
                <Brain size={20} className="text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-brand-primary bg-clip-text text-transparent">
                YouTube AI Summarizer
              </span>
            </Link>

            <nav
              aria-label="Primary"
              className="hidden md:flex items-center gap-6 text-body-sm font-medium"
            >
              <Link
                href="/blog"
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                Blog
              </Link>
              <Link
                href="/faq"
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                FAQ
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <ThemeSwitcher />

            {/* Authentication Status and Actions */}
            {!user || user.is_anonymous ? (
              <div className="flex items-center">
                <Button
                  onClick={() => router.push("/auth/login")}
                  className="bg-gradient-brand-primary hover:bg-gradient-brand-primary-hover text-white rounded-full px-6"
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
                    {entitlements?.tier === "pro" && (
                      <DropdownMenuItem asChild>
                        <ManageSubscriptionButton />
                      </DropdownMenuItem>
                    )}
                    {entitlements?.tier === "pro" && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      onSelect={handleSignOut}
                      className="cursor-pointer"
                    >
                      <LogOut size={16} />
                      <span>Sign Out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
