/**
 * AES-256-GCM encryption for Google OAuth tokens stored at rest (worker copy).
 * Kept in sync with artifacts/api-server/src/routes/google/google-crypto.ts.
 *
 * Key source: GOOGLE_OAUTH_ENCRYPTION_KEY (32 bytes, hex or base64).
 * Format: <iv_b64url>:<authTag_b64url>:<ciphertext_b64url>
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getKey(): Buffer {
  const raw = process.env["GOOGLE_OAUTH_ENCRYPTION_KEY"];
  if (!raw) throw new Error("GOOGLE_OAUTH_ENCRYPTION_KEY not set");
  if (raw.length === 64 && /^[0-9a-f]+$/i.test(raw)) return Buffer.from(raw, "hex");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error(`GOOGLE_OAUTH_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length})`);
  return buf;
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptToken(ciphertext: string): string {
  if (!ciphertext.includes(":")) {
    // Legacy plaintext token — re-auth needed.
    return ciphertext;
  }
  const key = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted token format");
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return decipher.update(Buffer.from(dataB64, "base64url")).toString("utf8") + decipher.final("utf8");
}
