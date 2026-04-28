// app/(design-system)/_components/TokenSwatch.tsx
import * as React from "react";

export function TokenSwatch({
  name,
  utilityClass,
  description,
}: {
  name: string;
  utilityClass: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className={`h-20 rounded-md border border-border-subtle ${utilityClass}`}
        aria-hidden="true"
      />
      <div className="flex flex-col">
        <code className="text-body-sm font-mono text-text-primary">{name}</code>
        <span className="text-body-xs text-text-muted">{utilityClass}</span>
        {description && (
          <span className="text-body-xs text-text-secondary mt-1">
            {description}
          </span>
        )}
      </div>
    </div>
  );
}
