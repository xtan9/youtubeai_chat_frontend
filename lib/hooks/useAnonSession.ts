"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/lib/contexts/user-context";

async function bootstrapAnonymousSession(): Promise<Session | null> {
  try {
    const { auth } = createClient();
    const existing = await auth.getSession();
    if (existing.error) throw existing.error;
    if (existing.data.session) return existing.data.session;

    const { data, error } = await auth.signInAnonymously();
    if (error) {
      console.error("Anonymous sign-in error:", error);
      return null;
    }
    return data.session;
  } catch (error) {
    console.error("Error during anonymous authentication:", error);
    return null;
  }
}

// Concurrent widgets and React Strict Mode share the same pending request.
// A later mount can try again after a failed visit.
let pending: Promise<Session | null> | undefined;

export function useAnonSession() {
  const { session, isLoading: userLoading } = useUser();
  const [anonSession, setAnonSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (session || userLoading) {
      setAnonSession(null);
      setIsLoading(false);
      return;
    }
    let active = true;
    setIsLoading(true);
    pending ??= bootstrapAnonymousSession().finally(() => {
      pending = undefined;
    });
    void pending.then(result => {
      if (active) {
        setAnonSession(result);
        setIsLoading(false);
      }
    });
    return () => { active = false; };
  }, [session, userLoading]);

  return { anonSession, isLoading: !!userLoading || isLoading };
}
