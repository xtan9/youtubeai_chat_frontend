import { AlertCircle } from "lucide-react";

interface StreamErrorBannerProps {
  message: string;
}

export function StreamErrorBanner({ message }: StreamErrorBannerProps) {
  return (
    <div
      className="mb-6 bg-red-500/10 border border-red-500/20 rounded-xl p-4"
      role="alert"
      aria-live="assertive"
      data-testid="stream-error-banner"
    >
      <div className="flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
        <div>
          <p className="text-red-400 font-medium">Summary failed</p>
          <p className="text-red-300 text-sm mt-1">{message}</p>
        </div>
      </div>
    </div>
  );
}
