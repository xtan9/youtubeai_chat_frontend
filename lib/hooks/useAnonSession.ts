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
  const shouldBootstrap = !session && !userLoading;
  // undefined means this guest visit has not finished bootstrapping; null
  // means it finished without a session. Reset when the auth context takes over.
  const [result, setResult] = useState<Session | null>();
  if (!shouldBootstrap && result !== undefined) setResult(undefined);

  useEffect(() => {
    if (!shouldBootstrap) return;
    let active = true;
    pending ??= bootstrapAnonymousSession().finally(() => {
      pending = undefined;
    });
    void pending.then(session => {
      if (active) setResult(session);
    });
    return () => { active = false; };
  }, [shouldBootstrap]);

  return {
    anonSession: shouldBootstrap ? result ?? null : null,
    isLoading: !!userLoading || (shouldBootstrap && result === undefined),
  };
}
