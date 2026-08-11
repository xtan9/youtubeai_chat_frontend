"use client";

import { useEffect, useRef } from "react";
import { usePostHog } from "posthog-js/react";
import { useUser } from "@/lib/contexts/user-context";
import { isSmokeAccount } from "@/lib/auth/smoke-account";
import {
  ANALYTICS_SUBJECT_PROPERTY,
  SMOKE_ACCOUNT_ANALYTICS_PROPERTIES,
} from "@/lib/analytics/identity";
import { setBusinessAnalyticsCaptureSuppressed } from "@/lib/analytics/client";

type PreviousIdentity = {
  id: string;
  isSmokeAccount: boolean;
};

export function PostHogUserIdentifier() {
  const posthog = usePostHog();
  const { user } = useUser();
  const previousIdentityRef = useRef<PreviousIdentity | null>(null);

  useEffect(() => {
    if (!posthog) return;

    const previousIdentity = previousIdentityRef.current;
    if (!user) {
      if (previousIdentity) {
        posthog.reset();
        posthog.unregister(ANALYTICS_SUBJECT_PROPERTY);
        posthog.opt_in_capturing({ captureEventName: false });
        setBusinessAnalyticsCaptureSuppressed(false);
        previousIdentityRef.current = null;
      }
      return;
    }

    const smoke = isSmokeAccount(user);
    if (user.is_anonymous && !smoke) {
      if (previousIdentity) posthog.reset();
      posthog.unregister(ANALYTICS_SUBJECT_PROPERTY);
      posthog.opt_in_capturing({ captureEventName: false });
      setBusinessAnalyticsCaptureSuppressed(false);
      previousIdentityRef.current = null;
      return;
    }

    if (
      previousIdentity &&
      (previousIdentity.id !== user.id ||
        previousIdentity.isSmokeAccount !== smoke)
    ) {
      posthog.reset();
    }

    if (smoke) {
      // Identify before opting out so anonymous events captured earlier in
      // this browser profile are merged into the durable synthetic person.
      posthog.identify(user.id, {
        account_type: user.is_anonymous ? "anonymous" : "registered",
        ...SMOKE_ACCOUNT_ANALYTICS_PROPERTIES,
      });
      posthog.register(SMOKE_ACCOUNT_ANALYTICS_PROPERTIES);
      setBusinessAnalyticsCaptureSuppressed(true);
      posthog.opt_out_capturing();
    } else {
      posthog.unregister(ANALYTICS_SUBJECT_PROPERTY);
      posthog.opt_in_capturing({ captureEventName: false });
      setBusinessAnalyticsCaptureSuppressed(false);
      posthog.identify(user.id, {
        account_type: "registered",
      });
    }
    previousIdentityRef.current = { id: user.id, isSmokeAccount: smoke };
  }, [posthog, user]);

  return null;
}
