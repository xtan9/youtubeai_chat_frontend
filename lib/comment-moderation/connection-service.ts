import "server-only";

import {
  decryptYouTubeToken,
  encryptYouTubeToken,
} from "./token-crypto";
import {
  getYouTubeConnection,
  refreshStoredAccessToken,
  saveYouTubeConnection,
  type StoredYouTubeConnection,
} from "./repository";
import {
  exchangeYouTubeAuthorizationCode,
  fetchAuthenticatedYouTubeChannel,
  refreshYouTubeAccessToken,
} from "./youtube-api";

export class YouTubeConnectionRequiredError extends Error {
  constructor(message: string = "Connect YouTube to continue") {
    super(message);
    this.name = "YouTubeConnectionRequiredError";
  }
}

export async function connectYouTubeAccount(input: {
  userId: string;
  code: string;
  origin: string;
}): Promise<void> {
  const tokens = await exchangeYouTubeAuthorizationCode({
    code: input.code,
    origin: input.origin,
  });
  if (!tokens.refreshToken) {
    throw new YouTubeConnectionRequiredError(
      "Google did not return offline access; reconnect and approve access",
    );
  }
  const channel = await fetchAuthenticatedYouTubeChannel(tokens.accessToken);
  await saveYouTubeConnection({
    userId: input.userId,
    channelId: channel.id,
    channelTitle: channel.title,
    encryptedAccessToken: encryptYouTubeToken(tokens.accessToken),
    encryptedRefreshToken: encryptYouTubeToken(tokens.refreshToken),
    accessTokenExpiresAt: tokens.expiresAt,
    grantedScopes: tokens.scopes,
  });
}

export async function getValidYouTubeAccess(input: {
  userId: string;
  connection?: StoredYouTubeConnection;
}): Promise<{ connection: StoredYouTubeConnection; accessToken: string }> {
  const connection =
    input.connection ?? (await getYouTubeConnection(input.userId));
  if (!connection) throw new YouTubeConnectionRequiredError();

  const expiresAt = Date.parse(connection.accessTokenExpiresAt);
  if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) {
    return {
      connection,
      accessToken: decryptYouTubeToken(connection.encryptedAccessToken),
    };
  }
  if (!connection.encryptedRefreshToken) {
    throw new YouTubeConnectionRequiredError("Reconnect YouTube to continue");
  }
  const refreshed = await refreshYouTubeAccessToken(
    decryptYouTubeToken(connection.encryptedRefreshToken),
  );
  const encryptedAccessToken = encryptYouTubeToken(refreshed.accessToken);
  await refreshStoredAccessToken({
    userId: input.userId,
    encryptedAccessToken,
    accessTokenExpiresAt: refreshed.expiresAt,
  });
  return {
    connection: {
      ...connection,
      encryptedAccessToken,
      accessTokenExpiresAt: refreshed.expiresAt,
    },
    accessToken: refreshed.accessToken,
  };
}
