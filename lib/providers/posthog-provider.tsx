"use client";

import posthog, { type CapturedNetworkRequest } from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";

export const POSTHOG_CAPTURE_OPTIONS = {
  capture_pageview: "history_change" as const,
  capture_pageleave: true,
  capture_exceptions: true,
  capture_performance: false,
};

const PRIVATE_PROJECT_NETWORK_PATHS = [
  /^\/workspace(?:\/|$)/,
  /^\/api\/projects(?:\/|$)/,
  /^\/api\/workspace\/projects(?:\/|$)/,
] as const;

/**
 * Project API and Workspace RSC requests/responses can contain private research
 * metadata, source URLs and titles, prompts, answers, Transcript passages, or
 * Artifact content. Workspace Project traffic also carries names and Goals.
 * Returning null uses PostHog's browser-side replay privacy boundary so the
 * URL, request body, and response payload never leave the device for replay.
 */
export function maskCapturedNetworkRequest(
  request: CapturedNetworkRequest,
): CapturedNetworkRequest | null {
  try {
    const path = new URL(request.name, "https://project-privacy.invalid").pathname;
    return PRIVATE_PROJECT_NETWORK_PATHS.some((pattern) => pattern.test(path))
      ? null
      : request;
  } catch {
    return request;
  }
}

export const POSTHOG_SESSION_RECORDING_OPTIONS = {
  blockClass: "ph-no-capture",
  blockSelector: "[data-ph-no-autocapture]",
  recordBody: false,
  recordHeaders: false,
  maskCapturedNetworkRequestFn: maskCapturedNetworkRequest,
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
      session_recording: POSTHOG_SESSION_RECORDING_OPTIONS,
    });
  }, []);

  return (
    <PHProvider client={posthog}>
      {children}
    </PHProvider>
  );
}
