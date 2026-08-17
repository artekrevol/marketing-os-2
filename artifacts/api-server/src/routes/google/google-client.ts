/**
 * Shared Google OAuth utilities for the API server.
 *
 * Handles token exchange, refresh, and the redirect-URI logic that
 * must be consistent between /start and /callback.
 */

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

// Only request these three sensitive scopes — do NOT add BigQuery, Cloud Storage,
// or other scopes left over from the previous SEO dashboard project in GCP.
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/business.manage",
].join(" ");

function clientId(): string {
  const v = process.env["GOOGLE_CLIENT_ID"];
  if (!v) throw new Error("GOOGLE_CLIENT_ID not set");
  return v;
}

function clientSecret(): string {
  const v = process.env["GOOGLE_CLIENT_SECRET"];
  if (!v) throw new Error("GOOGLE_CLIENT_SECRET not set");
  return v;
}

/**
 * Redirect URI registered in Google Cloud Console.
 * Override via GOOGLE_OAUTH_REDIRECT_URI env var, otherwise falls back
 * to the production deployment URL.
 */
export function getRedirectUri(): string {
  return (
    process.env["GOOGLE_OAUTH_REDIRECT_URI"] ??
    "https://marketing-os-revol.replit.app/api/google/oauth/callback"
  );
}

/** Build the Google OAuth authorization URL. */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: getRedirectUri(),
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent", // always return a refresh_token
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: getRedirectUri(),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<TokenResponse>;
}

/** Refresh an access token using a stored refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google token refresh failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<TokenResponse>;
}

export interface GoogleUserInfo {
  email: string;
  name?: string;
  picture?: string;
}

/** Fetch the Google account email for the connected account. */
export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Google userinfo fetch failed (${res.status})`);
  }
  return res.json() as Promise<GoogleUserInfo>;
}

/** List verified Search Console properties for the connected account. */
export async function listGscSites(accessToken: string): Promise<{ siteUrl: string; permissionLevel: string }[]> {
  const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GSC sites list failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> };
  return data.siteEntry ?? [];
}

/** Compute when an access token expires given its `expires_in` seconds value. */
export function tokenExpiryDate(expiresIn: number): Date {
  return new Date(Date.now() + expiresIn * 1000);
}
