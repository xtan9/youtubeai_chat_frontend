import Link from "next/link";
import { Brain, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileAvatar } from "@/components/profile-avatar";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "./types";

interface HeaderProps {
  user: User;
}

export function Header({ user }: HeaderProps) {
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  return (
    <header className="relative z-50 border-b border-white/10 backdrop-blur-md bg-white/5">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-cyan-500 rounded-xl flex items-center justify-center transform group-hover:scale-110 transition-transform">
              <Brain size={20} className="text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              youtubeai.chat
            </span>
          </Link>
          
          <div className="flex items-center gap-4">
            {/* Authentication Status and Actions */}
            {user.id === "guest" ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  <span className="text-gray-300">Not authenticated</span>
                </div>
                <Button 
                  onClick={() => router.push("/auth/login")}
                  className="bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white rounded-full px-6"
                >
                  Sign In
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-gray-300">Authenticated</span>
                </div>
                <ProfileAvatar user={user} />
                <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-gray-300 hover:text-white hover:bg-white/10 rounded-full">
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