export type ChannelDisclosureSection = Readonly<{
  id: string;
  heading: string;
  paragraphs: readonly string[];
  bullets: readonly string[];
}>;

export type ChannelPrivacyDisclosure = Readonly<{
  version: string;
  heading: string;
  introduction: string;
  sections: readonly ChannelDisclosureSection[];
}>;

/**
 * Public disclosure copy for the eventual Supported Creator Channel flow.
 * This copy describes the intended contract while the external verification,
 * clearance, provider, and deployment gates remain explicitly pending.
 */
export const SUPPORTED_CREATOR_CHANNEL_DISCLOSURE: ChannelPrivacyDisclosure = {
  version: "channel-disclosure-v1",
  heading: "Supported Creator Channel assistance",
  introduction:
    "Supported Creator Channel assistance is a private Channel Hub for an adult Channel Steward who connects one public, account-owned YouTube Channel. It assesses observable interaction behavior, not people. Written YouTube clearance, Google OAuth verification, and the complete launch packet are required before real YouTube API Data is processed; this repository does not claim those external gates, live channels, creator consent, OAuth credentials, or production evidence.",
  sections: [
    {
      id: "channel-access",
      heading: "Channel access and OAuth permissions",
      paragraphs: [
        "The connection is incremental and account-owned. The initial read permission is youtube.readonly and is used to verify the provider-returned public Channel identity. It does not permit publishing, editing, deleting, moderation, or access to held-for-review or likely-spam comments.",
        "The broader youtube.force-ssl permission is requested only when the Steward first chooses a write action. Connecting a Channel, scanning, requesting a draft, or publishing a previous reply never implies consent for a later write.",
      ],
      bullets: [
        "The read path is limited to published public comments and bounded same-thread context.",
        "A zero or ambiguous provider identity, missing authenticated account, invalid state, or unexpected scope blocks connection; a locally selected Channel cannot replace provider identity evidence.",
      ],
    },
    {
      id: "comment-assessment",
      heading: "Comment assessment and model-provider processing",
      paragraphs: [
        "A scan may create a private interaction assessment for the connected Channel Steward. Assessment and drafting are separate, structured server-side calls. The browser does not call the model provider, and a model cannot publish, dismiss, enforce, or select a Channel identity.",
        "Only the minimum bounded context needed for the requested assessment or draft is sent through a disclosed provider under applicable no-training and data-processing terms. The provider name, endpoint, model, and current terms must be disclosed before real Channel data is processed; this repository does not invent or certify a provider contract.",
      ],
      bullets: [
        "The bounded request can contain the current comment, distinct top-level comment, same-thread replies, Video title, thread relationship, supported-language indicator, and anonymous role markers.",
        "Author names, avatars, author Channel IDs, connected Channel IDs, Video/comment/reply IDs, OAuth tokens, API keys, account identity, cross-Video author history, and engagement history are not sent to the provider.",
        "Potential addresses, phone numbers, email addresses, schools, identity documents, and similar sensitive Safety Flag evidence are masked and excluded by default.",
      ],
    },
    {
      id: "private-drafts",
      heading: "Private AI drafts and final review",
      paragraphs: [
        "An AI-generated Reply Draft is private assistance. It is editable, is never public merely because it was generated, and is available only after the Steward confirms a non-severe Actionable Abuse assessment and separately requests a draft.",
        "Publication always requires per-item final review and deliberate confirmation of the exact final text. The product does not autonomously, silently, or in bulk publish replies, and the final text must pass the product validators before the one external write attempt.",
      ],
      bullets: [
        "Safety Flags and Allowed Criticism never receive a reply draft; Reviewable Interaction requires a human decision before it can become draft-eligible.",
        "The product does not edit a published reply in-app. External edits remain on YouTube.",
      ],
    },
    {
      id: "retention-refresh-and-deletion",
      heading: "Retention, refresh, and deletion",
      paragraphs: [
        "YouTube API Data used for Channel assistance is kept only for the bounded review lifecycle and no longer than 30 calendar days. Retained comment or reply text is refreshed or deleted within that window; a changed source creates a new assessment, and a deleted source removes local review text.",
        "Allowed Criticism raw text is not retained or shown in the Review Queue. Drafts, corrections, private review decisions, and audit provenance are also bounded by the same policy window. Durable analytics contain only non-identifying aggregates; logs do not contain comment text, draft text, author identity, or sensitive evidence.",
      ],
      bullets: [
        "Active reply-control provenance survives only while needed and while it is refreshed within each 30-day window.",
        "A public reply on YouTube remains public until the Steward separately deletes it; local retention expiry never silently deletes a public reply.",
      ],
    },
    {
      id: "revocation-and-disconnect",
      heading: "Revocation, disconnect, and account deletion",
      paragraphs: [
        "A registered owner can disconnect the Channel and revoke authorization regardless of subscription tier. New scans, drafts, and writes stop immediately when entitlement, identity, or grant state is unavailable. Local deletion starts even if Google's revocation endpoint is temporarily unavailable; the work remains visible and retryable and is not reported complete before the known provider and local outcomes are verified.",
        "Disconnect and account deletion remove tokens, Channel data, review text, drafts, and reply-control provenance under the applicable cleanup deadline. Once authorization or provenance is removed, product-assisted deletion cannot be promised without retaining data that should be deleted.",
      ],
      bullets: [
        "The Steward may use Google's account permissions page to review or revoke the grant when the provider surface is needed.",
        "A failed provider operation never becomes an unverified success and never authorizes a retry that could duplicate a reply.",
      ],
    },
    {
      id: "downgrade-and-youtube-fallback",
      heading: "Downgrade grace and the YouTube fallback",
      paragraphs: [
        "After paid access ends, new scans, assessments, drafts, and publications stop immediately. Existing Channel data remains available for export, local deletion, product-assisted public-reply deletion, or resubscription during a seven-day read-only grace period. At grace-period expiry, the grant is revoked and local Channel data is deleted.",
        "In-app public-reply deletion is available only while the original grant and refreshed provenance remain available, including during the grace period. After the grant or provenance is removed, the Steward must use YouTube's native tools, such as YouTube Studio, to delete a remaining public reply; YouTubeAI does not retain data to preserve an in-app deletion promise.",
      ],
      bullets: [
        "Changing the Active Connected Channel never transfers work or makes another Channel's draft publishable.",
        "There is no scheduled monitoring, bulk publication, or background reply action in this flow.",
      ],
    },
  ],
};

export const CHANNEL_DISCLOSURE_LINKS = {
  googlePermissions: "https://myaccount.google.com/permissions",
  youtubeStudio: "https://studio.youtube.com/",
} as const;
