// Pure-zod contract for the chat empty-state's three follow-up
// questions. Lives in a non-`server-only`-tagged module so build- and
// seed-time scripts (`scripts/build-hero-demo-data.ts`,
// `scripts/seed-hero-demo-suggestions.ts`) can import the same
// invariant the route + cache use without dragging in the Supabase
// service-role client. The route file
// `lib/services/suggested-followups.ts` re-exports for backwards-
// compat with existing callers.
import { z } from "zod";

export const SuggestedFollowupsSchema = z
  .array(z.string().min(1).max(160))
  .min(3)
  .max(3);

export type SuggestedFollowups = z.infer<typeof SuggestedFollowupsSchema>;
