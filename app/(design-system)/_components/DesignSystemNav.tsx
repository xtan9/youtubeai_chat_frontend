// app/(design-system)/_components/DesignSystemNav.tsx
import * as React from "react";
import Link from "next/link";

const sections = [
  { href: "/design-system", label: "Overview" },
  { href: "/design-system/tokens", label: "Tokens" },
  { href: "/design-system/forms", label: "Forms" },
  { href: "/design-system/containers", label: "Containers" },
  { href: "/design-system/navigation", label: "Navigation" },
  { href: "/design-system/data-display", label: "Data Display" },
  { href: "/design-system/composites", label: "Composites" },
];

export function DesignSystemNav() {
  return (
    <nav
      aria-label="Design system sections"
      className="sticky top-0 h-screen w-56 shrink-0 border-r border-border-subtle bg-surface-raised p-6"
    >
      <h2 className="text-h6 mb-4 text-text-primary">Design System</h2>
      <ul className="flex flex-col gap-2">
        {sections.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="block rounded px-2 py-1 text-body-sm text-text-secondary hover:bg-state-hover hover:text-text-primary"
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
