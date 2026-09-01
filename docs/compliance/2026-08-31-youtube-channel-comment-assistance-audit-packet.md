# YouTube API Services compliance audit packet: Channel comment assistance

## Submission status

This packet requests a written YouTube API Services determination for the
approved Channel comment-assistance use case. It describes the intended
production behavior; it is not a claim that the use case is already permitted.
No real YouTube API Data may be used by the product until YouTube gives the
required written clearance.

| Field | Value |
| --- | --- |
| API client | YouTubeAI |
| Product surface | Channel Hub / Review Queue |
| Use case | Assist a Channel Steward with reviewing published public comments and, only after explicit human approval, preparing and publishing a reply |
| Audience | The owner of one verified, account-owned YouTube Channel at a time |
| Requested decision | Whether per-comment behavioral assessment for a Channel Steward is permitted under the YouTube API Services policies and derived-metrics rules |
| Product source of truth | [Approved Channel comment-assistance spec](https://github.com/xtan9/youtubeai_chat_frontend/blob/main/docs/specs/2026-08-31-comment-assistance-discovery.md) |
| Current state | Compliance pending; real API Data access and user-visible release are blocked |

This is a creator-first, assistive workflow. The product helps a Channel
Steward review observable interaction behavior and retain control of their
public voice. It does not diagnose, shame, or assign a personality to an
author.

## Decision requested from YouTube

Please provide a written yes/no determination, including any conditions,
amendments, verification steps, or prohibited parts, for this exact use case:

> Is YouTubeAI permitted to perform a private, per-comment behavioral
> assessment for a Channel Steward using published public YouTube comments and
> bounded same-thread context, classify the interaction into the product's
> `Allowed Criticism`, `Reviewable Interaction`, `Actionable Abuse`, or
> `Safety Flag` action classes, and use that result to assist the Steward with
> an editable reply draft, under the YouTube API Services Developer Policies
> and the Additional Policies on Derived Metrics and Data Storage?

In particular, please answer:

1. Is this per-comment behavioral assessment a prohibited derived metric or
   custom label, even though it is private, shown only to the verified Channel
   Steward, bound to one interaction, not a numeric score, and not used to rank
   or profile authors?
2. If the assessment is permitted, does the same determination cover the
   separate, structured drafting call to a disclosed model provider under
   no-training terms, with the data minimization and retention controls below?
3. Is the incremental OAuth design below sufficient for channel identity
   verification, public-comment reads, explicit per-reply publication, and
   product-assisted deletion of a reply? If not, which scopes, consent wording,
   or verification steps are required?
4. Are there any additional YouTube API Services policies, derived-metrics or
   analytics amendments, privacy disclosures, or audit materials required
   before this exact workflow may access real comments?

The requested determination is about custom per-comment assessment itself. The
product will not rename the output, send it through another API route, request
a broader scope, or otherwise route around a finding that the assessment is
prohibited.

## 1. Intended use and operating boundary

The first release operates only for a Pro user who has self-attested that they
are 18 or older and has connected and verified one public, account-owned
Channel. The product does not collect a birth date or identity document. A
Channel Steward can initiate a deliberate scan of the most recent seven days
of published public comments. The scan is bounded to at most 200 top-level
threads and four scans per account per hour. There is one active connected
Channel at a time; every item remains bound to the Channel grant that created
it.

The workflow is deliberately split into separate actions:

1. Read published public comments.
2. Assess each candidate interaction privately.
3. Let the Steward review the context and choose whether to request a draft.
4. Let the Steward edit, approve, or discard a draft.
5. Publish one exact, user-confirmed reply, if the Steward explicitly chooses
   that action.

A scan only creates assessments. It never creates a public reply, and a model
result never dismisses, enforces, or publishes on the Steward's behalf.

### Assessment classes and actions

| Private class | Intended meaning | Product action |
| --- | --- | --- |
| `Allowed Criticism` | Content-focused disagreement or negativity that is not actionable abuse | Leave the comment untouched; do not retain or show its raw text in the Review Queue; an aggregate count may be reported |
| `Reviewable Interaction` | The available context is insufficient for a safe decision | Show bounded context to the Steward; no draft until the Steward makes the review decision |
| `Actionable Abuse` | Observable abuse clearly targeting the Channel Steward and not a severe-harm case | Permit an editable draft only after the Steward confirms the class and separately requests a draft |
| `Safety Flag` | Credible threat, doxxing, stalking, extortion, severe hate, minor-safety risk, self-harm encouragement, or other potentially severe real-world harm | Provide a private safety/enforcement path; never create a reply draft and never publish a reply |

A `Reviewable Interaction` itself is never sent to the drafting path. It can
become draft-eligible only if the Steward's review decision changes the item
to a confirmed, non-severe `Actionable Abuse` case.

The class is an interaction-level review decision, not an author-level
attribute. The product has no numeric risk score, model-confidence percentage,
author reputation, commenter profile, or cross-Video history. It makes no
repeat-harassment, coordinated-brigading, audience, demographic, or
psychological claim.

## 2. YouTube access, OAuth scopes, and consent

### Complete YouTube OAuth scope inventory

The Channel use case requests exactly these YouTube OAuth scopes, incrementally:

| Scope | When requested | Intended use | Not used for |
| --- | --- | --- | --- |
| `https://www.googleapis.com/auth/youtube.readonly` (`youtube.readonly`) | When the Pro user connects a Channel | Verify the authenticated user's public Channel identity with `channels.list` and `mine=true`; bind the grant to the returned Channel | Writing, editing, deleting, moderating, or reading private moderation queues |
| `https://www.googleapis.com/auth/youtube.force-ssl` (`youtube.force-ssl`) | Only when the Steward first chooses a write action | Make the one user-confirmed `comments.insert` reply request and, while grant and provenance remain valid, a separately confirmed `comments.delete` request | Automatic publication, bulk actions, channel management, uploads, or any capability not required by the reply lifecycle |

No other YouTube OAuth scope is requested by v1. In particular, v1 does not
request `youtube`, `youtube.upload`, `youtubepartner`, or a moderation-specific
scope. YouTubeAI account sign-in and its application session are separate from
the YouTube Data API authorization described here.

The scope descriptions and incremental-authorization approach are documented
in [Using OAuth 2.0 for Server-Side Web Applications](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps)
and [Implementing OAuth 2.0 Authorization](https://developers.google.com/youtube/v3/guides/authentication).

### API-key read path

After identity verification, the server reads only published public comment
threads and replies using the server-only `YOUTUBE_DATA_API_KEY` YouTube Data
API key. The read path
uses the public read methods needed for the bounded scan, such as
[`commentThreads.list`](https://developers.google.com/youtube/v3/docs/commentThreads/list)
and [`comments.list`](https://developers.google.com/youtube/v3/docs/comments/list),
scoped to the verified Channel or its owned Videos and the recent scan window.

The API key:

- is held and used only on the server;
- is never sent to the browser, model provider, logs, or user-visible output;
- is not an ownership credential and is never used to infer ownership;
- is not used with `mine=true` to replace the OAuth identity check;
- cannot be used to access private moderation queues; and
- is not used to read, access, or process held-for-review or likely-spam
  comments.

The OAuth `youtube.readonly` grant verifies the Channel identity. It does not
turn a public API-key read into an authorized write identity, and a locally
selected Channel ID can never substitute for the `mine=true` result. Zero
verified Channels fails closed. Multiple returned `mine=true` Channels cannot
be resolved by arbitrarily choosing one; the user must establish a separate,
unambiguous grant for the intended Channel.

### Express consent and final user control

The read grant does not imply permission to publish. Before the first write,
the product explains that `youtube.force-ssl` is broad and requests it
incrementally in the context of the chosen write action. Every public reply is
a distinct action requiring specific and express consent for that interaction:

1. The Steward opens one Review Queue item and sees the comment being
   answered, bounded thread context, Video title, uploading Channel, and the
   YouTube account identity to which the reply will be attributed.
2. The Steward explicitly confirms the relevant assessment and chooses
   **Request draft**. Draft generation is never automatic after a scan.
3. The Steward may edit the draft, mark the item as criticism, dismiss or defer
   it, open the item on YouTube, or abandon the reply.
4. The exact final text is shown with the publishing identity and must pass the
   product's privacy, threat, impersonation, diagnosis, spam, and link checks.
5. The Steward deliberately chooses **Publish reply** for that one item. The
   server makes at most one external write attempt after revalidating the
   Channel, entitlement, current comment, write scope, final text, daily
   allowance, and exclusive item claim.

There is no implied consent from connecting a Channel, scanning, requesting a
draft, publishing a previous reply, or accepting a general product
disclosure. There is no autonomous or bulk publication path. A targeted nested
reply receives a sibling thread reply; if identity is unambiguous, a
deterministic `@displayName` prefix is added after generation and the name is
not sent to the model. Missing or ambiguous identity permits only **Open in
YouTube**.

The product does not edit a published reply in-app. While authorization and
refreshed provenance remain valid, a Steward may separately confirm deletion
of a product-published reply through [`comments.delete`](https://developers.google.com/youtube/v3/docs/comments/delete).
The product never silently deletes a user-approved public reply.

These controls follow the [YouTube API Services Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality),
including displaying the comment being answered, the Video and uploading
Channel, and the account to which the reply will be attributed.

## 3. Assessment, derived metrics, and explicit exclusions

### What the product would assess

For a candidate published public comment, the assessment may use only the
candidate, its top-level comment, bounded neighboring replies in the same
thread, the Video title, and anonymous role markers such as `Steward`, `guest`,
or `other participant`. It does not use cross-Video author history. The
assessment is private assistance for the verified owner of the connected
Channel and is not a YouTube enforcement decision.

The proposed output is a custom action class derived from API Data. Therefore,
the product expressly asks YouTube to decide whether it is a prohibited
derived metric or custom label, rather than assuming that private display or
the absence of a numeric score makes it allowed. The governing references are
the [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies),
the [Developer Policies guide](https://developers.google.com/youtube/terms/developer-policies-guide),
and [Additional Policies on Derived Metrics and Data Storage](https://developers.google.com/youtube/terms/derived-metrics-policy).

### What the product will not do

The Channel use case explicitly does not:

- score authors, commenters, Channels, or interactions with a risk,
  reputation, sentiment, confidence, safety, or quality number;
- profile commenters or maintain a commenter identity/history across Videos;
- infer an author's personality, mental state, intent, protected traits, or
  life circumstances;
- operate on a third-party Channel or a Studio-permission delegate's Channel;
- rank commenters, Channels, or threads, or optimize for reply count or
  engagement;
- automate, schedule, bulk-publish, or silently publish replies;
- make an assessment authoritatively for YouTube or change a comment's
  moderation status;
- access, read, copy, assess, or publish from YouTube's held-for-review or
  likely-spam queues; or
- use a different name, OAuth scope, API endpoint, or product route to evade a
  policy finding.

Held-for-review and likely-spam comments remain in YouTube Studio. The v1 read
path is limited to published public comments. A Safety Flag can expose native
YouTube and real-world safety paths, but it never creates a reply on behalf of
another commenter or guest.

## 4. Model-provider data flow

The model call is server-side assistance, separate from the YouTube API call.
The Next.js server sends a minimized, bounded request through the existing
server-only LLM Gateway to the disclosed model provider selected for the
release. The browser never calls the provider directly. The provider is used
only to return a structured assessment or a draft; it cannot publish, dismiss,
enforce, or select the Channel identity.

### Data sent to the provider

| Call | Data sent | Conditions |
| --- | --- | --- |
| Assessment | The current candidate comment text, its top-level comment text when different, bounded same-thread neighboring reply text, Video title, thread relationship, supported-language indicator, and anonymous role markers | Only the minimum bounded context needed to assess the interaction; comments are untrusted data, not instructions |
| Draft | The minimum bounded context above, the server-owned confirmed non-severe `Actionable Abuse` class, target relationship, language, and neutral drafting constraints | Sent only after the Steward confirms the class and requests a draft; never sent for `Safety Flag`, `Allowed Criticism`, or unconfirmed `Reviewable Interaction` |
| Validation context | Server-owned taxonomy, prompt, and validator version identifiers needed to validate the structured response | Version identifiers are not user or Channel identity and do not authorize an external action |

Potential addresses, phone numbers, email addresses, schools, identity
documents, and similar sensitive Safety Flag evidence are masked before the
provider call and excluded from model input, draft output, and logs by default.
The model receives no author name to construct the nested-reply mention; the
server adds a permitted deterministic display-name prefix after generation.

### Data excluded from the provider

The provider does not receive:

- author display names, usernames, avatars, or author Channel IDs;
- the connected Channel ID, Video ID, comment ID, reply ID, OAuth access or
  refresh token, API key, application account identity, or publishing identity;
- raw addresses, phone numbers, email addresses, schools, identity documents,
  or other masked Safety Flag evidence;
- cross-Video author history, commenter profiles, analytics, or engagement
  history;
- held-for-review or likely-spam data;
- the user's final publishing confirmation or any credential capable of
  publishing or deleting on YouTube; or
- unrelated transcripts, Projects, Summary/History records, or application
  session data.

The provider is disclosed to the user in the private product flow and must be
bound by no-training terms: the request and response may be processed to
provide the requested inference, but the provider may not train, fine-tune,
profile, sell, or otherwise reuse the data for a secondary purpose. YouTubeAI
does not send real API Data to a provider whose applicable contract does not
provide those protections. The deployed provider name, endpoint, model ID, and
current data-processing/no-training terms must be attached to the final
compliance submission; this packet does not fabricate a vendor approval or a
provider-specific retention promise that has not been verified.

## 5. Retention, revocation, and deletion

YouTubeAI applies the conservative 30-calendar-day API Data window to both
public data read with the API key and data obtained through the OAuth grant.
The product does not retain raw text merely because it was convenient to cache
or because a model assessed it.

| Data or record | Retention and refresh rule |
| --- | --- |
| `Allowed Criticism` text | Not retained and not displayed in the Review Queue; only a non-identifying aggregate count may survive |
| Candidate, top-level, and bounded reply text used for review | Refresh or delete within 30 calendar days; if the source comment changes, its text hash creates a new assessment; if it is deleted, local review text is removed |
| Draft text, user corrections, and private review decisions | Keep only for the bounded review lifecycle and no longer than 30 calendar days; logs never contain comment or draft text |
| Audit provenance | Keep at most 30 calendar days and only as needed to bind Channel, comment opaque ID/hash, model/prompt/taxonomy/validator versions, review decision, publication identity/time/ID, and deletion/reconciliation outcome; no comment, draft, or sensitive evidence text |
| Active reply-control record | May survive only while needed and refreshed within each 30-day window; delete it on revocation or unrefreshed expiry |
| Model-provider request/response | Transient inference only under the disclosed provider's no-training terms; provider-side logging or retention must be disclosed in the provider attachment and must not defeat the 30-day deletion/refresh control; otherwise the provider path is blocked |
| OAuth tokens | Stored only as long as necessary for the specific consented purpose; no username/password is stored |
| Durable analytics | Non-identifying aggregates only; raw API Data, drafts, comment IDs, author identity, and Channel identity do not survive their bounded lifecycle |
| Public reply on YouTube | Remains public until the Steward separately deletes it; product retention expiry does not silently delete it |

The product handles authorization and deletion as follows:

- **Revocation:** The Steward can disconnect/revoke the Channel regardless of
  subscription tier. New scans, drafts, and writes stop immediately when the
  grant, identity, or entitlement is unavailable. Revocation starts cleanup of
  tokens, Channel data, review text, drafts, and reply-control provenance.
- **Account deletion or disconnect:** Local deletion proceeds even if Google's
  revocation endpoint is temporarily unavailable; the product keeps the
  revocation/deletion work visible and retryable, points the Steward to
  Google's revocation surface, and does not report complete compliance work
  before the known provider and local outcomes are verified.
- **Downgrade:** New scans, drafts, and publications stop immediately. Existing
  Channel data remains available for export, local deletion, product-assisted
  public-reply deletion, or resubscription during a seven-day read-only grace
  period. At grace-period expiry, the Google token is revoked and local
  Channel data is deleted.
- **Public replies:** Product-assisted deletion is available only while the
  original grant and refreshed provenance exist, including the downgrade grace
  period. After revocation or provenance removal, the product gives the
  Steward instructions to delete the reply on YouTube instead of retaining
  data to preserve an in-app promise it can no longer fulfill.

## 6. Quota and failure controls

The product applies one uniform operating limit to every Pro user:

| Control | Limit or behavior |
| --- | --- |
| User-initiated scans | At most four per account per hour; no scheduled monitoring or background notification in v1 |
| Threads per scan | At most 200 top-level threads, covering the recent seven-day window and reporting actual page/thread/time coverage |
| Public replies | At most 10 per account per day; deleting a reply does not consume this allowance |
| YouTube quota | A shared read/write YouTube quota budget is monitored; exhaustion fails new work uniformly and never causes an unbounded retry loop |
| Reply insertion | [`comments.insert`](https://developers.google.com/youtube/v3/docs/comments/insert) costs 50 quota units per API call and uses the broad `youtube.force-ssl` scope |
| Product-assisted reply deletion | [`comments.delete`](https://developers.google.com/youtube/v3/docs/comments/delete) costs 50 quota units per API call; it does not consume the 10-reply publication allowance |
| External write attempts | One attempt per claimed item after atomic precondition validation; an ambiguous result becomes `Publication Uncertain` and disables retry until reconciliation verifies absence |
| Scan failure | Items fail independently; the Scan Run reports `Completed`, `Partial`, `Cancelled`, or `Failed` with exact coverage and failure class |

The [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
and [YouTube spam policy](https://support.google.com/youtube/answer/2801973?hl=en)
remain applicable. The product does not use the quota allowance to justify
high-volume or repetitive generated comments.

## 7. Compliance gate and no-go decision

The following are hard release gates, not claims satisfied by this packet:

- YouTube's written determination that the exact per-comment assessment and
  derived-metrics treatment is permitted;
- OAuth verification and approval of the described incremental scopes;
- live privacy and provider disclosures, including deletion and revocation
  instructions;
- fixed multilingual offline evaluation with zero prohibited drafts and the
  approved precision/recall gates;
- end-to-end publication, uncertain-publication, revocation, downgrade, and
  deletion evidence;
- quota, cost, accessibility, and production-readiness evidence; and
- verified 30-day refresh/deletion behavior and seven-day downgrade cleanup.

If YouTube rejects custom per-comment behavioral assessment, the decision is a
hard **no-go**. YouTubeAI will not rename the assessment as a tag, signal,
insight, or moderation hint; move it to another endpoint; request a broader
scope; send it through another model or route; or otherwise work around the
finding. Real-comment integration stops, the frozen implementation experiment
([Draft PR #466](https://github.com/xtan9/youtubeai_chat_frontend/pull/466))
closes without merge, and a materially different native-moderation product
requires new product discovery and approval.

Until the written determination and all other gates pass, implementation is
limited to documentation, synthetic/governed evaluation data, and inert
infrastructure. This packet contains no real user comments or fabricated
approval evidence.

## References and submission attachments

The submission should include this packet, the approved product spec, and the
following first-party policy/API references:

- [Approved Channel comment-assistance spec](https://github.com/xtan9/youtubeai_chat_frontend/blob/main/docs/specs/2026-08-31-comment-assistance-discovery.md)
- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [Complying with YouTube's Developer Policies](https://developers.google.com/youtube/terms/developer-policies-guide)
- [Additional Policies on Derived Metrics and Data Storage](https://developers.google.com/youtube/terms/derived-metrics-policy)
- [YouTube API Services Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [Using OAuth 2.0 for Server-Side Web Applications](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps)
- [Channels: list](https://developers.google.com/youtube/v3/docs/channels/list)
- [CommentThreads: list](https://developers.google.com/youtube/v3/docs/commentThreads/list)
- [Comments: list](https://developers.google.com/youtube/v3/docs/comments/list)
- [Comments: insert](https://developers.google.com/youtube/v3/docs/comments/insert)
- [Comments: delete](https://developers.google.com/youtube/v3/docs/comments/delete)

Before an audit submission is sent, attach the exact deployed provider/model
and its no-training/data-processing terms, the live privacy/deletion
disclosures, OAuth consent screens, and the evidence listed in the release
gate. No attachment may contain real API Data unless the written determination
authorizes the relevant use.
