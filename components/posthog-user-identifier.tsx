"use client";

import { useEffect, useRef } from "react";
import { usePostHog } from "posthog-js/react";
import { useUser } from "@/lib/contexts/user-context";

export function PostHogUserIdentifier() {
  const posthog = usePostHog();
  const { user } = useUser();
  const previousUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!posthog) return;

    const previousUserId = previousUserIdRef.current;
    if (!user) {
      if (previousUserId) {
        posthog.reset();
        previousUserIdRef.current = null;
      }
      return;
    }

    if (previousUserId && previousUserId !== user.id) {
      posthog.reset();
    }

    posthog.identify(user.id, {
      account_type: user.is_anonymous ? "anonymous" : "registered",
    });
    previousUserIdRef.current = user.id;
  }, [posthog, user]);

  return null;
}
