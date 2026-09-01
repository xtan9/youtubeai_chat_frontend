import { z } from "zod";

export const YOUTUBE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/youtube.readonly" as const;
export const YOUTUBE_FORCE_SSL_SCOPE =
  "https://www.googleapis.com/auth/youtube.force-ssl" as const;

export const YOUTUBE_OAUTH_SCOPES = [
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_FORCE_SSL_SCOPE,
] as const;

export const YOUTUBE_READONLY_SCOPE_SET = [YOUTUBE_READONLY_SCOPE] as const;

export const YouTubeOAuthScopeSchema = z.enum(YOUTUBE_OAUTH_SCOPES);
export type YouTubeOAuthScope = z.infer<typeof YouTubeOAuthScopeSchema>;
