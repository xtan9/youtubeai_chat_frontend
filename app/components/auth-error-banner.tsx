import { AlertCircle } from "lucide-react";
import type { User } from "./types";

interface AuthErrorBannerProps {
  authError: string | null;
  user: User;
}

export function AuthErrorBanner({ authError, user }: AuthErrorBannerProps) {
  if (!authError) return null;

  return (
    <div className="mb-6 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
        <div>
          <p className="text-red-400 font-medium">Authentication Error</p>
          <p className="text-red-300 text-sm mt-1">{authError}</p>
          {user.id !== "guest" && (
            <p className="text-red-300 text-xs mt-2">Redirecting to sign in page in 3 seconds...</p>
          )}
        </div>
      </div>
    </div>
  );
} 