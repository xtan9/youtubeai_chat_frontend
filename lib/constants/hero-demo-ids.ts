/**
 * Single source of truth for "what counts as a hero-demo sample." Two
 * consumers depend on this list staying in lockstep:
 *   - app/components/hero-demo-data/index.ts (the SAMPLES registry,
 *     which asserts its ids equal this tuple at module-eval time).
 *   - app/api/chat/stream/route.ts (which lifts the anon-chat 402
 *     for these ids only).
 *
 * Keep this tuple sorted in the visible-grid order — the registry
 * iterates in this order to render the 2x3 thumbnail grid.
 */
export const HERO_DEMO_VIDEO_IDS = [
  "Hrbq66XqtCo",
  "nm1TxQj9IsQ",
  "Mde2q7GFCrw",
  "csA9YhzYvmk",
  "BWJ4vnXIvts",
  "Yy-EC-BdoNY",
] as const;

export type HeroDemoVideoId = (typeof HERO_DEMO_VIDEO_IDS)[number];

export function isHeroDemoVideoId(id: string | null | undefined): id is HeroDemoVideoId {
  if (id === null || id === undefined) return false;
  return (HERO_DEMO_VIDEO_IDS as readonly string[]).includes(id);
}
