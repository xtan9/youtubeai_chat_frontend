"use client";
import { useState, type ReactNode } from "react";

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
