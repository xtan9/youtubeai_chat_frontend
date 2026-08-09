"use client";

import posthog, { type CapturedNetworkRequest } from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";

export const POSTHOG_CAPTURE_OPTIONS = {
  capture_pageview: "history_change" as const,
  capture_pageleave: true,
  capture_exceptions: true,
};

const PROJECT_SEARCH_NETWORK_PATH = /^\/api\/projects\/[^/]+\/search$/;

/**
 * Project Search requests and responses contain private research text.
 * Returning null uses PostHog's browser-side replay privacy boundary so the
 * URL, POST body, and exact result payload never leave the device for replay.
 */
export function maskCapturedNetworkRequest(
  request: CapturedNetworkRequest,
): CapturedNetworkRequest | null {
  try {
    const path = new URL(request.name, "https://project-search.invalid").pathname;
    return PROJECT_SEARCH_NETWORK_PATH.test(path) ? null : request;
  } catch {
    return request;
  }
}

export const POSTHOG_SESSION_RECORDING_OPTIONS = {
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
