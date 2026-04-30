"use client";

import { useEntitlements } from "@/lib/hooks/useEntitlements";
import { AnonSignupWall } from "@/components/paywall/AnonSignupWall";

/**
 * Renders an AnonSignupWall above the URL form when an anonymous user has
 * used their 1 lifetime summary. Placed just above <InputForm /> in page.tsx.
 * Implemented as a client component so it can read useEntitlements() without
 * converting the static HeroSection to a client boundary.
 */
export function AnonHomepageGate() {
  const { data: ent } = useEntitlements();
  const anonCapHit =
    ent?.tier === "anon" &&
    typeof ent.caps.summariesUsed === "number" &&
    ent.caps.summariesUsed >= ent.caps.summariesLimit;

  if (!anonCapHit) return null;

  return (
    <div className="w-full max-w-6xl mx-auto mb-6">
      <AnonSignupWall reason="hit-cap" />
    </div>
  );
}
