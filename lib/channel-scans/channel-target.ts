/** Synthetic IDs are reserved for the offline fixture provider. */
const SYNTHETIC_CHANNEL_ID = /^synthetic-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONNECTED_CHANNEL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isSyntheticScanChannelId(value: string): boolean {
  return SYNTHETIC_CHANNEL_ID.test(value.trim());
}

export function isRealScanChannelId(value: string): boolean {
  return CONNECTED_CHANNEL_UUID.test(value.trim());
}

export function isSupportedScanChannelId(value: string): boolean {
  return isSyntheticScanChannelId(value) || isRealScanChannelId(value);
}
