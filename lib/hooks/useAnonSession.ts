"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/lib/contexts/user-context";

const debugLog: (...args: unknown[]) => void =
  process.env.NODE_ENV === "production" ? () => {} : console.log;

/**
 * Bootstraps a Supabase anonymous session for unauthenticated callers.
 *
 * Flow:
 *   1. If a real user is signed in, do nothing.
 *   2. If a Supabase session already exists in storage, reuse it.
 *   3. Otherwise call `signInAnonymously()` and stash the resulting session.
 *
 * Returns the session so callers can read `access_token` for fetches against
 * routes that require a Supabase user (chat, summarize). The session is
 * `null` until the effect resolves.
 *
 * Extracted from the original inline block in `useYouTubeSummarizer` so the
 * hero demo widget on `/` can authenticate `<ChatTab>` without mounting the
 * full summarizer hook.
 */
export function useAnonSession(): {
  anonSession: Session | null;
  isLoading: boolean;
} {
  const { session } = useUser();
  const [anonSession, setAnonSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // `isLoading` is in the deps array AND is set inside the effect, so
  // every effect run cleans itself up before the async resolves. A
  // naive `cancelled = true` cleanup flag would therefore drop every
  // session. The single-bootstrap guard above keeps that safe: the
  // effect only enters its body once per real auth state change.
  useEffect(() => {
    async function getAnonymousSession() {
      if (session || anonSession || isLoading) return;
      setIsLoading(true);
      try {
        const supabase = createClient();
        const { data: sessionData } = await supabase.auth.getSession();

        if (sessionData?.session) {
          debugLog("Using existing anonymous session");
          setAnonSession(sessionData.session);
          return;
        }

        debugLog("Signing in anonymously");
        const { data, error } = await supabase.auth.signInAnonymously();

        if (error) {
          console.error("Anonymous sign-in error:", error);
          return;
        }
        if (data?.session) {
          debugLog("Anonymous sign-in successful");
          setAnonSession(data.session);
        }
      } catch (err) {
        console.error("Error during anonymous authentication:", err);
      } finally {
        setIsLoading(false);
      }
    }

    getAnonymousSession();
  }, [session, anonSession, isLoading]);

  return { anonSession, isLoading };
}
