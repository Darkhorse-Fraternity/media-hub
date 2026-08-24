import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM 加密 OAuth token，存进 db。
 * key 来自 env MEDIA_HUB_CRYPTO_KEY（base64 的 32 字节）。
 *
 * 输出格式（hex 字符串拼接，便于 db text 字段存）：
 *   ${iv_hex}:${ciphertext_hex}:${authTag_hex}
 *
 * 不依赖外部库，Node 内置 crypto 即可。
 */

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // GCM 推荐 12 字节

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.MEDIA_HUB_CRYPTO_KEY;
  if (!raw) {
    throw new Error(
      "Missing MEDIA_HUB_CRYPTO_KEY env (32 bytes base64). Generate via `openssl rand -base64 32`.",
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `MEDIA_HUB_CRYPTO_KEY must be 32 bytes (got ${buf.length}). Use \`openssl rand -base64 32\`.`,
    );
  }
  cachedKey = buf;
  return buf;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("hex"),
    ciphertext.toString("hex"),
    authTag.toString("hex"),
  ].join(":");
}

export function decryptToken(payload: string): string {
  const parts = payload.split(":");
  const [ivHex, ciphertextHex, authTagHex] = parts;
  if (parts.length !== 3 || !ivHex || !ciphertextHex || !authTagHex) {
    throw new Error("Malformed encrypted token payload");
  }
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
