// app/(design-system)/layout.tsx
import * as React from "react";
import { DesignSystemNav } from "./_components/DesignSystemNav";

export default function DesignSystemLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-surface-base text-text-primary">
      <DesignSystemNav />
      <div className="flex-1">{children}</div>
    </div>
  );
}
