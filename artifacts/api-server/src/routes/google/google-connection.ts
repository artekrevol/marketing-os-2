import { sql } from "drizzle-orm";
import { guardedDb } from "@workspace/db";
import {
  refreshAccessToken,
  tokenExpiryDate,
} from "./google-client.js";
import { decryptToken, encryptToken } from "./google-crypto.js";

export type GoogleConnectionRow = Record<string, unknown> & {
  id: string;
  token_expiry: string;
  access_token: string;
  refresh_token: string;
};

/** Load the encrypted OAuth connection for one already-authorized brand. */
export async function loadGoogleConnection(
  brandId: string,
): Promise<GoogleConnectionRow | null> {
  const result = (await guardedDb.execute(sql`
    SELECT id::text, google_account_email, access_token, refresh_token,
           token_expiry, scopes, gsc_property_url, ga4_property_id,
           business_profile_account_name, business_profile_location_names
    FROM google_brand_connections
    WHERE brand_id = ${brandId}::uuid
    LIMIT 1
  `)) as unknown as { rows?: unknown[] } | unknown[];
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  return (rows[0] ?? null) as GoogleConnectionRow | null;
}

/** Refresh the shared access token when it is within five minutes of expiry. */
export async function ensureFreshGoogleToken(
  connection: GoogleConnectionRow,
): Promise<string> {
  const expiry = new Date(connection.token_expiry);
  const refreshThreshold = new Date(Date.now() + 5 * 60 * 1000);
  if (expiry > refreshThreshold) {
    return decryptToken(connection.access_token);
  }

  const tokens = await refreshAccessToken(decryptToken(connection.refresh_token));
  const newExpiry = tokenExpiryDate(tokens.expires_in);
  await guardedDb.execute(sql`
    UPDATE google_brand_connections
    SET access_token = ${encryptToken(tokens.access_token)},
        token_expiry = ${newExpiry.toISOString()},
        updated_at = now()
    WHERE id = ${connection.id}::uuid
  `);
  return tokens.access_token;
}