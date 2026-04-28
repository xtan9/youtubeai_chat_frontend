import { AlertCircle } from "lucide-react";
import { useUser } from "@/lib/contexts/user-context";

interface AuthErrorBannerProps {
  authError: string | undefined;
}

export function AuthErrorBanner({ authError }: AuthErrorBannerProps) {
  const { user } = useUser();
  if (!authError) return null;

  return (
    <div className="mb-6 bg-accent-danger/10 border border-accent-danger/20 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-accent-danger shrink-0" />
        <div>
          <p className="text-accent-danger font-medium">Authentication Error</p>
          <p className="text-accent-danger text-sm mt-1">{authError}</p>
          {user && (
            <p className="text-accent-danger text-xs mt-2">
              Redirecting to sign in page in 3 seconds...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
