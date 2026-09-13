/**
 * Stripe Webhook の共通処理：本文の上限つき読み取りと署名検証。
 *
 * 購入通知用（/api/integrations/stripe/webhook）と課金用（/api/hq/billing/webhook）が
 * 同じものを使う。秘密鍵は呼ぶ側が env から渡す（ここには書かない）。
 */

export const MAX_STRIPE_WEBHOOK_BODY_BYTES = 256 * 1024;
const MAX_STRIPE_SIGNATURE_HEADER_BYTES = 4 * 1024;
const MAX_STRIPE_V1_SIGNATURES = 8;
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

export async function readBodyWithinLimit(request: Request): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_STRIPE_WEBHOOK_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Stripe署名検証。秘密鍵ローテーション中の複数 v1 署名も検証する。 */
export async function verifyStripeSignature(
  secret: string,
  rawBody: string,
  sigHeader: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (new TextEncoder().encode(sigHeader).byteLength > MAX_STRIPE_SIGNATURE_HEADER_BYTES) return false;
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const item of sigHeader.split(',')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key === 't' && timestamp === undefined) timestamp = value;
    if (key === 'v1' && value) {
      if (signatures.length >= MAX_STRIPE_V1_SIGNATURES) return false;
      signatures.push(value);
    }
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)
    || Math.abs(nowSeconds - timestampSeconds) > STRIPE_SIGNATURE_TOLERANCE_SECONDS) return false;

  const signatureBytes = signatures.map(hexToBytes).filter((value): value is Uint8Array => value !== null);
  if (signatureBytes.length === 0) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signedPayload = encoder.encode(`${timestamp}.${rawBody}`);
  const results = await Promise.all(
    signatureBytes.map((signature) => crypto.subtle.verify('HMAC', key, signature, signedPayload)),
  );
  return results.some(Boolean);
}
