// app/(design-system)/_components/ComponentShowcase.tsx
import * as React from "react";

export function ComponentShowcase({
  name,
  importPath,
  children,
}: {
  name: string;
  importPath: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-border-subtle rounded-lg p-6 bg-surface-raised">
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="text-h3">{name}</h2>
        <code className="text-body-sm text-text-muted">{importPath}</code>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
        {children}
      </div>
    </section>
  );
}
