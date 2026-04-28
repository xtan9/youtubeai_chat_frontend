import { AlertCircle } from "lucide-react";

interface StreamErrorBannerProps {
  message: string;
}

export function StreamErrorBanner({ message }: StreamErrorBannerProps) {
  return (
    <div
      className="mb-6 bg-accent-danger/10 border border-accent-danger/20 rounded-xl p-4"
      role="alert"
      aria-live="assertive"
      data-testid="stream-error-banner"
    >
      <div className="flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-accent-danger shrink-0" />
        <div>
          <p className="text-accent-danger font-medium">Summary failed</p>
          <p className="text-accent-danger text-sm mt-1">{message}</p>
        </div>
      </div>
    </div>
  );
}
