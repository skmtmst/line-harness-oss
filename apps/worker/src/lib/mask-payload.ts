/**
 * 外部連携のやり取りの本文を伏せて返す（F-18）。
 *
 * 伏せ方（PR に書く内容と同じ）:
 * - 鍵の名前で伏せる: 名前・電話・メール・住所・トークン・生年月日に当たる鍵
 *   の値は、文字・数・真偽によらずすべて伏せる。部分一致のため、
 *   個人でない同名の値も伏せる側に倒す。
 * - 値の形で伏せる: メールアドレス・電話番号・LINE の userId（U＋16進32桁）・
 *   IP アドレス（IPv4）の形は、文の途中にあっても置き換える。
 * - 生年月日は「年月日の形」だけでは注文日と見分けられないため、
 *   生年月日の鍵の値を伏せる。鍵の無い文中の日付は伏せない。
 * - 伏せ字は `***`。前後を残さない（前後4文字でも個人を特定し得るため）。
 * - JSON でない本文・空の本文は伏せようがなく、body には null を返す。
 * - 元の本文は変えない。DB の値も変えない。返すときだけ伏せる。
 */

const MASKED = '***';

/** 伏せる鍵（小文字・部分一致）。個人でない同名も伏せる側に倒す。 */
const SENSITIVE_KEY_PATTERN =
  /name|namae|氏名|名前|姓|mei|phone|tel|mobile|電話|email|e-mail|mail|メール|メアド|address|addr|住所|zip|postal|郵便|都道府県|市区|token|secret|password|passwd|pwd|auth|apikey|api[_-]?key|access[_-]?key|bearer|トークン|合言葉|暗証|birth|dob|生年月日|誕生/i;

/** 文の途中にあっても置き換える形。 */
const EMAIL_GLOBAL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_GLOBAL_PATTERN = /(?:0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}|\+81[-\s]?\d{1,4}[-\s]?\d{3,4})/g;
const LINE_USER_ID_GLOBAL_PATTERN = /\bU[0-9a-f]{32}\b/gi;
const IPV4_GLOBAL_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

function maskFreeText(value: string): string {
  return value
    .replace(EMAIL_GLOBAL_PATTERN, MASKED)
    .replace(PHONE_GLOBAL_PATTERN, MASKED)
    .replace(LINE_USER_ID_GLOBAL_PATTERN, MASKED)
    .replace(IPV4_GLOBAL_PATTERN, MASKED);
}

function maskValue(key: string, value: unknown): unknown {
  // 伏せる鍵の値は文字以外（数・真偽など）も伏せる。
  if (SENSITIVE_KEY_PATTERN.test(key)) return MASKED;
  if (typeof value === 'string') return maskFreeText(value);
  if (Array.isArray(value)) return value.map((entry) => maskValue(key, entry));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, maskValue(childKey, child)]),
    );
  }
  return value;
}

export interface MaskedPayload {
  /** 伏せた本文。伏せようがないときは null。 */
  body: unknown;
  /** 本文があり、伏せて返せたか。 */
  available: boolean;
}

/** やり取りの本文（JSON 文字列）を伏せて返す。 */
export function maskInteractionPayload(raw: string | null): MaskedPayload {
  if (!raw) return { body: null, available: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { body: null, available: false };
  }
  if (parsed === null || typeof parsed !== 'object') return { body: null, available: false };
  return { body: maskValue('', parsed), available: true };
}
