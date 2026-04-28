// app/(design-system)/_components/TypeSpecimen.tsx
import * as React from "react";

export function TypeSpecimen({
  token,
  utilityClass,
  sample = "The quick brown fox jumps over the lazy dog",
}: {
  token: string;
  utilityClass: string;
  sample?: string;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border-subtle pb-4">
      <code className="text-body-xs font-mono text-text-muted">{token}</code>
      <span className={utilityClass}>{sample}</span>
    </div>
  );
}
