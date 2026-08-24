import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 无状态 OAuth state：HMAC-SHA256 签名 + base64url 编码。
 * 不依赖 db / 内存 Map，多实例部署也安全。
 *
 * 格式：${base64url(payload)}.${base64url(hmac)}
 *
 * 复用 MEDIA_HUB_CRYPTO_KEY 作为 HMAC key（HMAC 跟 AES-GCM 用同 key 是安全的，
 * 因为算法域不同；另起 key 更纯但增加运维负担）。
 */

interface StatePayload {
  /** 启动 OAuth 的用户 id（callback 时核对） */
  uid: string;
  /** 'youtube' | 'instagram' | 'tiktok' */
  p: string;
  /** 完成后跳回的前端路由 */
  rt: string;
  /** 随机 nonce */
  n: string;
  /** 过期时间戳 (ms) */
  e: number;
}

const STATE_TTL_MS = 10 * 60 * 1000; // 10 分钟

function getHmacKey(): Buffer {
  const raw = process.env.MEDIA_HUB_CRYPTO_KEY;
  if (!raw) {
    throw new Error("Missing MEDIA_HUB_CRYPTO_KEY env");
  }
  return Buffer.from(raw, "base64");
}

function sign(b64Payload: string): string {
  return createHmac("sha256", getHmacKey())
    .update(b64Payload)
    .digest("base64url");
}

export function createOAuthState(input: {
  userId: string;
  platform: "youtube" | "instagram" | "tiktok";
  returnTo: string;
}): string {
  const payload: StatePayload = {
    uid: input.userId,
    p: input.platform,
    rt: input.returnTo,
    n: randomBytes(8).toString("hex"),
    e: Date.now() + STATE_TTL_MS,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${b64}.${sign(b64)}`;
}

export function verifyOAuthState(state: string): {
  userId: string;
  platform: string;
  returnTo: string;
} {
  const dot = state.indexOf(".");
  if (dot < 0) {
    throw new Error("Malformed state");
  }
  const b64 = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = sign(b64);

  // timing-safe 比较
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("State signature mismatch");
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(b64, "base64url").toString("utf8"),
    ) as StatePayload;
  } catch {
    throw new Error("Invalid state payload");
  }

  if (payload.e < Date.now()) {
    throw new Error("State expired");
  }

  return {
    userId: payload.uid,
    platform: payload.p,
    returnTo: payload.rt,
  };
}
