"use client";

import { useEffect, useRef } from "react";
import { usePostHog } from "posthog-js/react";
import { useUser } from "@/lib/contexts/user-context";

export function PostHogUserIdentifier() {
  const posthog = usePostHog();
  const { user } = useUser();
  const previousRegisteredUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!posthog) return;

    const previousRegisteredUserId = previousRegisteredUserIdRef.current;
    if (!user || user.is_anonymous) {
      if (previousRegisteredUserId) {
        posthog.reset();
        previousRegisteredUserIdRef.current = null;
      }
      return;
    }

    if (
      previousRegisteredUserId &&
      previousRegisteredUserId !== user.id
    ) {
      posthog.reset();
    }

    posthog.identify(user.id, {
      account_type: "registered",
    });
    previousRegisteredUserIdRef.current = user.id;
  }, [posthog, user]);

  return null;
}
