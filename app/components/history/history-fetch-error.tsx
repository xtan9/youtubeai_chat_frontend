import { AlertTriangle } from "lucide-react";

type HistoryFetchErrorProps = {
  message: string;
};

export function HistoryFetchError({ message }: HistoryFetchErrorProps) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised px-4 py-3 text-text-primary"
    >
      <AlertTriangle
        className="h-5 w-5 shrink-0 text-accent-warning"
        aria-hidden="true"
      />
      <p className="text-body-sm">{message}</p>
    </div>
  );
}
