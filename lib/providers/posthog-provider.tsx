"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";

export const POSTHOG_CAPTURE_OPTIONS = {
  capture_pageview: "history_change" as const,
  capture_pageleave: true,
  capture_exceptions: true,
};

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    const projectToken = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
    if (!projectToken) {
      return;
    }
    posthog.init(projectToken, {
      api_host: "/ingest",
      ui_host: "https://us.posthog.com",
      ...POSTHOG_CAPTURE_OPTIONS,
    });
  }, []);

  return (
    <PHProvider client={posthog}>
      {children}
    </PHProvider>
  );
}
