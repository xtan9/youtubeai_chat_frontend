// app/(design-system)/_components/ShowcaseLayout.tsx
import * as React from "react";

export function ShowcaseLayout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="container mx-auto px-6 py-12">
      <h1 className="text-h1 mb-8">{title}</h1>
      <div className="flex flex-col gap-12">{children}</div>
    </main>
  );
}
