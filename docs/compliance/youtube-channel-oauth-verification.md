# YouTube Channel OAuth verification gate

Status: **pending external verification**.

The checked-in record at `docs/compliance/youtube-channel-oauth-verification.json`
intentionally contains no OAuth client, credential, reviewer approval, or
provider-verification claim. The Supported Creator Channel foundation must
remain unable to begin authorization until an authorized reviewer supplies
evidence for the exact incremental scopes.

Before this record can become verified, the release owner must preserve, outside
the application token store:

- the OAuth application verification or approval reference and review date;
- the exact consent configuration and approved YouTube scopes;
- the reviewer or authority responsible for the determination; and
- confirmation that the first grant is limited to `youtube.readonly`, with
  `youtube.force-ssl` deferred to a separately approved write flow.

No live YouTube data, OAuth credentials, creator rights, or production
readiness is established by this placeholder. A future server-owned release
process may replace the JSON record only after the evidence is independently
verified and the complete launch packet is available.
