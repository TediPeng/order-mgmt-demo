import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// AES-256-GCM encryption-at-rest for Pancake API keys / webhook secrets.
// Key source: the ENCRYPTION_KEY env var (any non-trivial string; it is
// SHA-256-hashed into the 32-byte AES key, so a long random passphrase or a
// 64-char hex string both work). Set it in .env.local and in Vercel env —
// rotating it invalidates stored credentials (they must be re-entered).
// Stored format: "v1:<iv b64>:<auth tag b64>:<ciphertext b64>".

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error(
      "ENCRYPTION_KEY env var is missing or too short (min 16 chars). It is required to store Pancake POS credentials encrypted at rest."
    );
  }
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const [version, ivB64, tagB64, ctB64] = stored.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) throw new Error("Unrecognized encrypted secret format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** Display mask: bullet padding + last 4 characters ("••••1234"). Safe to send
 * to the client — never send the decrypted value itself. */
export function maskSecret(plaintext: string): string {
  const tail = plaintext.length >= 4 ? plaintext.slice(-4) : plaintext;
  return `••••${tail}`;
}

export function maskStoredSecret(stored: string | null): string | null {
  if (!stored) return null;
  try {
    return maskSecret(decryptSecret(stored));
  } catch {
    return "••••????"; // undecryptable (e.g. rotated ENCRYPTION_KEY) — must be re-entered
  }
}
