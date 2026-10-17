/**
 * 受信系エンドポイント共通の HMAC-SHA256 照合。
 * 汎用のHMAC計算・比較を保ち、x-nenの5系統の検証もここへ集約する。
 */

/** Constant-time hex-string compare to avoid timing oracles. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function computeHmacSha256Hex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** x-nen の受信口だけの契約。Uber・LINE 等の別方式には適用しない。 */
export const NEN_WEBHOOK_SKEW_SECONDS = 5 * 60;
export const NEN_TIMESTAMP_HEADER = 'x-nen-timestamp';
export const NEN_SIGNATURE_HEADER = 'x-nen-signature';

/** 既存の前置き・時刻の形式/丸め方は、受信口ごとに保つ。 */
export type NenWebhookProfile = 'delivery' | 'ec' | 'support-relay' | 'ec-auto-line';
export type NenWebhookAuthResult =
  | { ok: true }
  | { ok: false; error: 'Expired request' | 'Invalid signature' };

export interface NenWebhookHeaders {
  profile: NenWebhookProfile;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  nowSeconds?: number;
}

/** EC 自動配信は、鍵/本文を読む前にも同じ形式・期限検査を行う。 */
export function validateNenWebhookHeaders(input: NenWebhookHeaders): NenWebhookAuthResult {
  const timestamp = input.timestamp || '';
  const seconds = Number(timestamp);
  const now = input.nowSeconds ?? Date.now() / 1000;
  const current = input.profile === 'support-relay' ? Math.floor(now) : now;
  const timestampValid = input.profile === 'support-relay'
    ? /^\d{10}$/.test(timestamp)
    : input.profile === 'ec-auto-line'
      ? /^\d+$/.test(timestamp)
      : Number.isInteger(seconds);
  if (!timestampValid || !Number.isFinite(seconds) || Math.abs(current - seconds) > NEN_WEBHOOK_SKEW_SECONDS) {
    return { ok: false, error: 'Expired request' };
  }
  return /^[0-9a-f]{64}$/.test(normalizedNenSignature(input))
    ? { ok: true }
    : { ok: false, error: 'Invalid signature' };
}

function normalizedNenSignature(input: NenWebhookHeaders): string {
  const signature = input.signature || '';
  if (input.profile === 'support-relay') return signature.toLowerCase();
  // 自動LINEの既存送信元は小文字の sha256= のみ。他の口へ合わせて許可を増やさない。
  if (input.profile === 'ec-auto-line') {
    const provided = signature.replace(/^sha256=/, '');
    if (!/^\w{64}$/.test(provided)) return '';
    // 既存口のbyte復号も契約として保持する（parseIntの途中終了/NaN→0を含む）。
    // 厳密な16進だけに狭める修正は受理結果が変わるため、この整理とは分ける。
    return Array.from(Uint8Array.from(provided.match(/../g)!, (pair) => Number.parseInt(pair, 16)),
      (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return signature.replace(/^sha256=/i, '').toLowerCase();
}

export async function verifyNenWebhook(input: NenWebhookHeaders & {
  secret: string;
  rawBody: string;
  /** EC連携だけが所属確認済みの宛先を渡す。鍵の探索は呼び出し側の責務。 */
  accountId?: string;
}): Promise<NenWebhookAuthResult> {
  const valid = validateNenWebhookHeaders(input);
  if (!valid.ok) return valid;
  const timestamp = input.timestamp || '';
  const payload = input.accountId === undefined
    ? `${timestamp}.${input.rawBody}`
    : `${timestamp}.${input.accountId}.${input.rawBody}`;
  const expected = await computeHmacSha256Hex(input.secret, payload);
  return safeEqualHex(normalizedNenSignature(input), expected)
    ? { ok: true }
    : { ok: false, error: 'Invalid signature' };
}
