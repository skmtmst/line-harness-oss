/** 既存の各受信口の上限。共通化しても大きい方へ揃えない。 */
export const WEBHOOK_BODY_BYTES = {
  delivery: 128 * 1024,
  ec: 256 * 1024,
  ecAutoLine: 64 * 1024,
} as const;

/** メール中継は署名対象全体のバイト数ではなく、JSON内のbase64文字数の制限。 */
export const SUPPORT_EMAIL_RAW_MAX_CHARACTERS = 14 * 1024 * 1024;

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function isWebhookBodyTooLarge(rawBody: string, maxBytes: number): boolean {
  return utf8Length(rawBody) > maxBytes;
}

/** 申告値だけでは信用しない。本文読取り後のUTF-8検査と併用する。 */
export function isDeclaredWebhookBodyTooLarge(value: string | undefined, maxBytes: number): boolean {
  const declaredLength = Number(value || '0');
  return Number.isFinite(declaredLength) && declaredLength > maxBytes;
}
