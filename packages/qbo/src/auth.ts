// QuickBooks Online OAuth 2.0 helpers
// NOTE: QBO does not allow creating company files via API.
// Clients must create their own QBO account, then connect it here.

import OAuthClient from "intuit-oauth";

function createOAuthClient() {
  return new OAuthClient({
    clientId: process.env.QBO_CLIENT_ID!,
    clientSecret: process.env.QBO_CLIENT_SECRET!,
    environment: (process.env.QBO_ENVIRONMENT as "sandbox" | "production") ?? "sandbox",
    redirectUri: process.env.QBO_REDIRECT_URI!,
  });
}

export function getAuthorizationUrl(state: string): string {
  const client = createOAuthClient();
  return client.authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state,
  });
}

export interface QBOTokenResponse {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiry: Date;
  realmId: string;
}

export async function exchangeCodeForTokens(
  url: string,
  realmId: string
): Promise<QBOTokenResponse> {
  const client = createOAuthClient();
  const authResponse = await client.createToken(url);
  const tokenData = authResponse.getJson();

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    accessTokenExpiry: new Date(Date.now() + tokenData.expires_in * 1000),
    realmId,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<QBOTokenResponse & { realmId?: string }> {
  const client = createOAuthClient();
  // Manually set the refresh token so we can refresh it
  client.setToken({ refresh_token: refreshToken } as Parameters<typeof client.setToken>[0]);
  const refreshResponse = await client.refresh();
  const tokenData = refreshResponse.getJson();

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    accessTokenExpiry: new Date(Date.now() + tokenData.expires_in * 1000),
  };
}
