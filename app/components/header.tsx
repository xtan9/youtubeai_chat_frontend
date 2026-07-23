"use client";

import Link from "next/link";
import { LogOut, User as UserIcon } from "lucide-react";
import { YtAiMark } from "@/components/brand/yt-ai-mark";
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
import { resetAnalyticsIdentity } from "@/lib/analytics/client";

export function Header() {
  const { user } = useUser();
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (!error) {
      resetAnalyticsIdentity();
    }
    // Navigate to home page
    router.push("/");
  };

  return (
    <header className="sticky top-0 w-full z-50 border-b border-border-subtle backdrop-blur-md bg-surface-base/95 dark:bg-gradient-to-r dark:from-gray-900/95 dark:to-black/95">
      <div className="mx-auto max-w-page px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link
              href="/"
              aria-label="YouTube AI Chat home"
              className="flex items-center gap-3 group"
            >
              <div className="w-10 h-10 bg-gradient-brand-primary rounded-xl flex items-center justify-center transform group-hover:scale-110 transition-transform">
                <YtAiMark className="w-7 h-7 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-brand-primary bg-clip-text text-transparent">
                YouTube AI Chat
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
                    <DropdownMenuItem asChild>
                      <Link
                        href="/account"
                        className="cursor-pointer flex items-center gap-2"
                      >
                        <UserIcon size={16} />
                        <span>Account</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
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
