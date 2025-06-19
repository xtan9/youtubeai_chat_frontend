"use client";

import Link from "next/link";
import { Brain, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileAvatar } from "@/components/profile-avatar";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/lib/contexts/user-context";

export function Header() {
  const { user } = useUser();
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    // Navigate to home page
    router.push("/");
  };

  return (
    <header className="sticky top-0 w-full z-50 border-b border-white/10 backdrop-blur-md bg-gradient-to-r from-gray-900/95 to-black/95">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-cyan-500 rounded-xl flex items-center justify-center transform group-hover:scale-110 transition-transform">
              <Brain size={20} className="text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              www.youtubeai.chat
            </span>
          </Link>

          <div className="flex items-center gap-4">
            {/* Authentication Status and Actions */}
            {!user || user.is_anonymous ? (
              <div className="flex items-center">
                <Button
                  onClick={() => router.push("/auth/login")}
                  className="bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white rounded-full px-6"
                >
                  Sign In
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <ProfileAvatar user={user} />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSignOut}
                  className="text-gray-300 hover:text-white hover:bg-white/10 rounded-full"
                >
                  <LogOut size={16} />
                  <span className="ml-2 hidden sm:inline">Sign Out</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
