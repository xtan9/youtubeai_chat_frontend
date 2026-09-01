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
  ChannelGrantReference,
  ChannelPrincipal,
  ConnectedChannelReference,
  PublishingAuthorization,
} from "./access";

export { selectActiveConnectedChannel } from "./active";
export type { ActiveChannelSelectionResult } from "./active";

export {
  beginSupportedCreatorChannelOAuth,
  ChannelOAuthStateSchema,
  completeSupportedCreatorChannelOAuth,
  validateChannelOAuthCallbackState,
} from "./oauth";
export type {
  ChannelOAuthAuthorizationRequest,
  ChannelOAuthCallbackResult,
  ChannelOAuthStartResult,
  ChannelOAuthState,
  ChannelOAuthStateIssue,
  ChannelOAuthStateStore,
  ChannelOAuthStateValidationResult,
  YouTubeChannelOAuthProvider,
} from "./oauth";

export {
  CURRENT_YOUTUBE_OAUTH_VERIFICATION,
  evaluateYouTubeOAuthVerificationGate,
  YouTubeOAuthVerificationSchema,
} from "./oauth-verification";
export type {
  YouTubeOAuthVerification,
  YouTubeOAuthVerificationGate,
} from "./oauth-verification";

export {
  EncryptedOAuthTokenEnvelopeSchema,
  OAuthCredentialReferenceSchema,
  YouTubeOAuthTokenSetSchema,
  createEnvironmentOAuthTokenEncryptor,
  decryptYouTubeOAuthTokenSet,
  encryptYouTubeOAuthTokenSet,
} from "./credentials";
export type {
  EncryptedOAuthTokenEnvelope,
  OAuthCredentialReference,
  OAuthCredentialStore,
  OAuthTokenEncryptor,
  YouTubeOAuthTokenSet,
} from "./credentials";

export {
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_OAUTH_SCOPES,
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_READONLY_SCOPE_SET,
  YouTubeOAuthScopeSchema,
} from "./scopes";
export type { YouTubeOAuthScope } from "./scopes";

export {
  ProviderChannelIdentitySchema,
  NATIVE_YOUTUBE_TOOLS_GUIDANCE,
  resolveSupportedCreatorChannel,
} from "./identity";
export type {
  ProviderChannelIdentity,
  ProviderIdentityResolution,
} from "./identity";

export {
  YOUTUBE_CHANNEL_OAUTH_CALLBACK_PATH,
  YOUTUBE_CHANNEL_OAUTH_CALLBACK_URI,
  YOUTUBE_CHANNEL_OAUTH_CONSENT_TEXT,
  YOUTUBE_CHANNEL_OAUTH_CONTRACT,
  YOUTUBE_CHANNEL_OAUTH_SCOPES,
  YOUTUBE_CHANNEL_OAUTH_START_PATH,
  hasYouTubeWriteAuthorizationScopes,
  isValidYouTubeReadAuthorization,
  toYouTubeReadAuthorization,
  validateYouTubeOAuthCallback,
} from "../channel-oauth";
export type {
  YouTubeOAuthAuthorization,
  YouTubeOAuthCallbackBlockedReason,
  YouTubeOAuthCallbackInput,
  YouTubeOAuthCallbackResult,
  YouTubeOAuthIntent,
  YouTubeOAuthScope as YouTubeChannelOAuthScope,
  YouTubeReadAuthorization,
} from "../channel-oauth";

export {
  CURRENT_YOUTUBE_CHANNEL_OAUTH_VERIFICATION,
  YouTubeChannelOAuthVerificationSchema,
  evaluateYouTubeChannelOAuthVerificationGate,
  parseYouTubeChannelOAuthVerification,
} from "../compliance/youtube-channel-oauth-verification";
export type {
  YouTubeChannelOAuthVerification,
  YouTubeChannelOAuthVerificationGate,
} from "../compliance/youtube-channel-oauth-verification";

export {
  beginChannelOnboarding,
  completeChannelOnboarding,
} from "./journey";
export type {
  ChannelOnboardingGates,
  ChannelConnectionPersistence,
  ChannelOnboardingIds,
  ChannelOnboardingResult,
  ChannelOnboardingStartResult,
  ReadAuthorizationState,
} from "./journey";
export { evaluateChannelOnboardingGates } from "./gates";
export type { ChannelOnboardingGateResult } from "./gates";

export {
  authorizeChannelPublication,
  applyPublicReplyPublicationOutcome,
  beginPublicReplyPublication,
  buildYouTubeReplyUrl,
  completePublicReplyPublication,
  createInMemoryPublicReplyLifecycleStore,
  createSyntheticPublicReplyProvider,
  deletePublicReply,
  hashCommentText,
  isCoherentPublicReplyControlRecord,
  isPublicReplyPublicationRetryable,
  openPublicReplyOnYouTube,
  openPublishedPublicReply,
  reconcilePublicReply,
} from "./publication";
export type {
  BeginPublicReplyPublicationResult,
  ChannelPublicationDecision,
  ChannelPublicationDeniedReason,
  ChannelPublicationPreflight,
  CompletePublicReplyPublicationResult,
  DeletePublicReplyResult,
  InMemoryPublicReplyLifecycleStore,
  OpenPublishedPublicReplyResult,
  PublicReplyControlRecord,
  PublicReplyDeletionAuthorization,
  PublicReplyDeletionProviderResult,
  PublicReplyDeletionStatus,
  PublicReplyLifecycleProvider,
  PublicReplyLifecycleStatus,
  PublicReplyLifecycleStore,
  PublicReplyProviderObservation,
  PublicReplyProviderReply,
  PublicReplyProviderRequest,
  PublicReplyPublicationProviderResult,
  PublicReplySourceContext,
  PublicReplyTarget,
  PublicReplyVideo,
  ReconcilePublicReplyResult,
  SyntheticPublicReplyProvider,
} from "./publication";
export {
  PublicReplyControlRecordSchema,
  PublicReplyDeletionProviderResultSchema,
  PublicReplyDeletionStatusSchema,
  PublicReplyLifecycleStatusSchema,
  PublicReplyProviderObservationSchema,
  PublicReplyProviderReplySchema,
  PublicReplyPublicationProviderResultSchema,
  PublicReplySourceContextSchema,
  PublicReplyTargetSchema,
  PublicReplyVideoSchema,
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
