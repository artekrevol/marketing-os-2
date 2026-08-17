/**
 * AES-256-GCM encryption for Google OAuth tokens stored at rest.
 *
 * Key source: GOOGLE_OAUTH_ENCRYPTION_KEY env var (32 bytes).
 * Accepts either a 64-char hex string or a base64-encoded string.
 *
 * Ciphertext format (all base64url, colon-separated):
 *   <12-byte IV>:<16-byte GCM auth tag>:<encrypted payload>
 *
 * Both access_token and refresh_token are encrypted before writing to DB
 * and decrypted only at point of use.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getKey(): Buffer {
  const raw = process.env["GOOGLE_OAUTH_ENCRYPTION_KEY"];
  if (!raw) throw new Error("GOOGLE_OAUTH_ENCRYPTION_KEY not set");
  // 64-char lowercase hex → 32 bytes
  if (raw.length === 64 && /^[0-9a-f]+$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  // Otherwise assume base64 (44 chars → 32 bytes for standard base64)
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `GOOGLE_OAUTH_ENCRYPTION_KEY must be exactly 32 bytes (got ${buf.length} bytes decoded)`,
    );
  }
  return buf;
}

/** Encrypt a plaintext string. Returns a colon-separated base64url string. */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

/** Decrypt a value produced by encryptToken. Throws on tampered/invalid input. */
export function decryptToken(ciphertext: string): string {
  // Passthrough for plaintext tokens stored before encryption was added
  // (detect by absence of the IV:tag:data pattern).
  if (!ciphertext.includes(":")) {
    // Legacy plaintext — return as-is but log a warning so ops knows to re-auth.
    console.warn(
      "[google-crypto] decryptToken received a non-encrypted token — " +
      "this brand needs to re-authenticate to enable encrypted storage.",
    );
    return ciphertext;
  }
  const key = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted token format (expected iv:tag:data)");
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString("utf8") + decipher.final("utf8");
}
