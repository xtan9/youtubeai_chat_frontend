# Comment Shield

Comment Shield is an authenticated moderation workspace for two use cases:

- **Creator:** scan recent top-level comments and replies across the connected
  user's YouTube channel.
- **Viewer:** scan replies under the connected user's own top-level comments on
  one supplied YouTube video.

The classifier uses three labels. `hostile` is reserved for targeted personal
attacks, threats, slurs, sexual harassment, or unmistakable provocation.
`critical` covers negative or rude criticism that is still about the content.
`benign` is not shown in the review queue. Only a high-confidence `hostile`
result can qualify for automatic publishing.

## Google Cloud setup

1. Enable the YouTube Data API v3 in the Google Cloud project.
2. Create a Web application OAuth client.
3. Add the exact callback URL, for example
   `http://localhost:3000/api/youtube/oauth/callback` locally and
   `https://www.youtubeai.chat/api/youtube/oauth/callback` in production.
4. Add `https://www.googleapis.com/auth/youtube.force-ssl` to the consent
   screen. This scope allows the app to read and publish comments. Public apps
   should complete Google's OAuth verification before rollout.
5. Configure the five server-only environment variables listed in
   `.env.example`.
6. Apply the Supabase migration through the repository's normal pull-request
   workflow. Do not push it manually to production.

The connection flow is intentionally separate from sign-in. Users can sign in
with email or Google without granting comment-management access, and can later
connect or revoke a YouTube identity from Comment Shield.

## Security and storage

- The OAuth `state` is signed, expires after ten minutes, and is bound to the
  authenticated Supabase user.
- Access and refresh tokens are encrypted with AES-256-GCM before database
  storage. The encryption key is never exposed to the browser.
- Connection and moderation tables have RLS enabled and explicitly revoke
  `anon` and `authenticated` table access. Only authenticated server routes use
  the service-role boundary after validating the current user.
- Disconnect first asks Google to revoke the token, then deletes the connection
  and its moderation records.
- A unique `(user_id, youtube_comment_id)` constraint prevents duplicate scans
  from producing duplicate replies. A compare-and-set status transition claims
  an item before publication.

## Quota and automation limits

At the time of implementation, YouTube charges one quota unit to list comment
threads or replies and 50 units to publish one reply. Comment Shield scans at
most 20 unseen candidates and publishes at most three automatic replies during
one manual scan. It does not run a background schedule in this version.

Human approval is the default. Turning on automatic publishing is a separate
setting and displays the quota and public-action warning next to the control.
