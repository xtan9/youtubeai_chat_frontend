"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

const sections = [
  "desk",
  "sources",
  "conversation",
  "research",
  "outputs",
  "search",
  "settings",
] as const;
export type ProjectSection = (typeof sections)[number];

export function currentProjectSection(params: URLSearchParams): ProjectSection {
  return (
    sections.find((section) => section === params.get("panel")) ??
    (params.has("conversationId") ? "conversation" : "desk")
  );
}

export function ProjectSectionLink({
  to,
  children,
  className,
  label,
}: {
  to: ProjectSection;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const pathname = usePathname();
  const params = new URLSearchParams(useSearchParams().toString());
  const defaultSection = params.has("conversationId") ? "conversation" : "desk";
  if (to === defaultSection) params.delete("panel");
  else params.set("panel", to);
  const href = params.size ? pathname + "?" + params : pathname;
  return (
    <Link
      href={href}
      prefetch={false}
      data-project-action={to}
      className={className}
      aria-label={label}
      title={label}
      onNavigate={(event) => {
        event.preventDefault();
        window.history.pushState(null, "", href);
      }}
    >
      {children}
    </Link>
  );
}

// Keep an unfinished question, search, or generation alive when switching sections.
export function ProjectSectionContent({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return active || visited ? <div hidden={!active}>{children}</div> : null;
}
