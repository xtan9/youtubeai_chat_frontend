"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/contexts/user-context";
import { useAnonSession } from "@/lib/hooks/useAnonSession";
import { getAuthErrorInfo } from "@/lib/utils/youtube";
import type { SummaryRunControllerOptions } from "@/lib/summary-run/summary-run";
import { useSummaryRun } from "@/lib/hooks/useSummaryRun";

export { SummaryRequestError } from "@/lib/summary-run/summary-run";

/**
 * Summary-page adapter. Authentication provisioning and login navigation are
 * page concerns; the lifecycle itself stays in `createSummaryRunController`.
 */
export function useYouTubeSummarizer() {
  const { user, session } = useUser();
  const router = useRouter();
  const { anonSession, isLoading } = useAnonSession();

  const handleAuthError = useCallback(
    (status: number, message: string) => {
      const errorInfo = getAuthErrorInfo(status, message);
      if (errorInfo.shouldRedirect && user) {
        setTimeout(() => {
          router.push("/auth/login");
        }, errorInfo.redirectDelay);
      }
    },
    [router, user],
  );

  const getAccessToken = useCallback(
    () => session?.access_token || anonSession?.access_token || null,
    [anonSession?.access_token, session?.access_token],
  );
  const runOptions = useMemo<SummaryRunControllerOptions>(
    () => ({
      getAccessToken,
      onAuthError: handleAuthError,
    }),
    [getAccessToken, handleAuthError],
  );
  const run = useSummaryRun(runOptions);

  return {
    ...run,
    isAnonymous:
      user?.is_anonymous === true || (!session && !!anonSession),
    isAuthLoading: isLoading,
  };
}
