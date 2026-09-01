/**
 * #471 owns real Connected YouTube Channel onboarding and identity checks.
 * Until that dependency lands, this ticket exposes only explicitly synthetic
 * targets. A real YouTube channel ID can never be smuggled through the offline
 * provider seam.
 */
const SYNTHETIC_CHANNEL_ID = /^synthetic-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSyntheticScanChannelId(value: string): boolean {
  return SYNTHETIC_CHANNEL_ID.test(value.trim());
}
