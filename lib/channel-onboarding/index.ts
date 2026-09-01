export {
  CHANNEL_ACTIONS,
  authorizeChannelAction,
} from "./access";
export type {
  AdultAttestation,
  ChannelAccessContext,
  ChannelAccessDecision,
  ChannelAccessDeniedReason,
  ChannelAction,
  ChannelEntitlement,
  ChannelEntitlementState,
  ChannelPrincipal,
  ConnectedChannelReference,
  PublishingAuthorization,
} from "./access";

export { selectActiveConnectedChannel } from "./active";
export type { ActiveChannelSelectionResult } from "./active";

export {
  ProviderChannelIdentitySchema,
  resolveSupportedCreatorChannel,
} from "./identity";
export type {
  ProviderChannelIdentity,
  ProviderIdentityResolution,
} from "./identity";

export {
  beginChannelOnboarding,
  completeChannelOnboarding,
} from "./journey";
export type {
  ChannelConnectionPersistence,
  ChannelOnboardingIds,
  ChannelOnboardingResult,
  ChannelOnboardingStartResult,
  ReadAuthorizationState,
} from "./journey";

export {
  authorizeChannelPublication,
} from "./publication";
export type {
  ChannelPublicationDecision,
  ChannelPublicationDeniedReason,
  ChannelPublicationPreflight,
} from "./publication";

export {
  ChannelConnectionSchema,
  ChannelGrantRecordSchema,
  ChannelRecordSchema,
  ConnectedChannelRecordSchema,
  isCoherentChannelConnection,
} from "./records";
export type {
  ChannelConnection,
  ChannelGrantRecord,
  ChannelRecord,
  ChannelWorkBinding,
  ConnectedChannelRecord,
} from "./records";

export { buildChannelCapabilityPresentation } from "./presentation";
export type { ChannelCapabilityPresentation } from "./presentation";
