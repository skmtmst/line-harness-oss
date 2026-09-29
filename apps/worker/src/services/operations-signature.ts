const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

/**
 * HMAC-SHA256 を hex で返す唯一の署名プリミティブ。
 * 受信検証（operations webhook）と送信署名（外部連携Webhook）の両方が
 * これを使い、署名アルゴリズムが経路ごとに分かれないようにする（N-372）。
 */
export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const digest = await crypto.subtle.sign(
    'HMAC', await key(secret), new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function signOperationsEvent(secret: string, timestamp: string, rawBody: string): Promise<string> {
  return hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
}

/**
 * 外部連携Webhookの署名入力を組み立てる（要件26 §6-5）。
 * `タイムスタンプ.イベントID.生の本文` の順で連結し、時刻の巻き戻しと
 * 別イベントへの署名の付け替えの両方を受け手が検知できるようにする。
 */
export function harnessSignaturePayload(timestamp: string, eventId: string, rawBody: string): string {
  return `${timestamp}.${eventId}.${rawBody}`;
}

export async function signHarnessEvent(
  secret: string,
  timestamp: string,
  eventId: string,
  rawBody: string,
): Promise<string> {
  return hmacSha256Hex(secret, harnessSignaturePayload(timestamp, eventId, rawBody));
}

export async function verifyOperationsEvent(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  rawBody: string,
): Promise<boolean> {
  if (secret.length < 32 || !timestamp || !/^\d{10}$/.test(timestamp) || !signature) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_CLOCK_SKEW_SECONDS) return false;
  const supplied = hexToBytes(signature.replace(/^sha256=/i, ''));
  if (!supplied) return false;
  return crypto.subtle.verify(
    'HMAC', await key(secret), supplied, new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
}
