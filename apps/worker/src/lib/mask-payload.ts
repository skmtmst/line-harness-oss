/**
 * 外部連携のやり取りの本文を伏せて返す（F-18）。
 *
 * 伏せ方（PR に書く内容と同じ）:
 * - 鍵の名前で伏せる: 名前・電話・メール・住所・トークンに当たる鍵
 *   （name / phone / tel / email / mail / address / token / secret /
 *   password / auth / api_key など、日本語の鍵も含む）の値は中身を見ず
 *   すべて伏せる。部分一致のため、個人でない同名の値も伏せる側に倒す。
 * - 値の形で伏せる: メールアドレス・電話番号の形の文字列は、鍵によらず伏せる。
 * - 伏せ字は `***`。前後を残さない（前後4文字でも個人を特定し得るため）。
 * - JSON でない本文・空の本文は伏せようがなく、body には null を返す。
 * - 元の本文は変えない。DB の値も変えない。返すときだけ伏せる。
 */

const MASKED = '***';

/** 伏せる鍵（小文字・部分一致）。個人でない同名も伏せる側に倒す。 */
const SENSITIVE_KEY_PATTERN =
  /name|namae|氏名|名前|姓|mei|phone|tel|mobile|電話|email|e-mail|mail|メール|メアド|address|addr|住所|zip|postal|郵便|都道府県|市区|token|secret|password|passwd|pwd|auth|apikey|api[_-]?key|access[_-]?key|bearer|トークン|合言葉|暗証/i;

/** 値の形で伏せるもの。 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^(?:0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}|\+81[-\s]?\d{1,4}[-\s]?\d{3,4})$/;

function maskString(key: string, value: string): string {
  if (SENSITIVE_KEY_PATTERN.test(key)) return MASKED;
  const trimmed = value.trim();
  if (EMAIL_PATTERN.test(trimmed) || PHONE_PATTERN.test(trimmed)) return MASKED;
  return value;
}

function maskValue(key: string, value: unknown): unknown {
  if (typeof value === 'string') return maskString(key, value);
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
