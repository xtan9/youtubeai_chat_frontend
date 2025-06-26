"use client";

import { useEffect } from "react";
import { usePostHog } from "posthog-js/react";
import { useUser } from "@/lib/contexts/user-context";

export function PostHogUserIdentifier() {
  const posthog = usePostHog();
  const { user } = useUser();

  useEffect(() => {
    if (!posthog || !user) return;

    // When user state changes and user is available, identify them in PostHog
    posthog.identify(user.id, {
      email: user.email,
      name: user.user_metadata?.full_name,
    });

    // Reset identity when user signs out
    return () => {
      if (user) return;
      posthog.reset();
    };
  }, [posthog, user]);

  return null;
}
