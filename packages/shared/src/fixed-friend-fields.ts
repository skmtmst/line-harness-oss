/** フォーム・情報欄・要点の欄が共通で使う10項目。IDは配布先に持ち込まない。 */
export const FIXED_FRIEND_FIELDS = [
  { key: 'name', label: '名前', type: 'text', format: 'none' },
  { key: 'kana', label: 'ふりがな', type: 'text', format: 'kana' },
  { key: 'birthday', label: '生年月日', type: 'date', format: 'none' },
  { key: 'age', label: '年齢', type: 'text', format: 'integer' },
  { key: 'email', label: 'メール', type: 'text', format: 'email' },
  { key: 'tel', label: '電話', type: 'text', format: 'tel' },
  { key: 'address', label: '住所', type: 'address', format: 'none' },
  { key: 'allergy', label: 'アレルギー', type: 'checkbox', format: 'none' },
  { key: 'anniversary', label: '記念日', type: 'date', format: 'none' },
  { key: 'seat_preference', label: '席の好み', type: 'text', format: 'none' },
] as const;
export type FixedFriendFieldKey = typeof FIXED_FRIEND_FIELDS[number]['key'];
export const isFixedFriendFieldKey = (key: unknown): key is FixedFriendFieldKey =>
  FIXED_FRIEND_FIELDS.some(field => field.key === key);

/** 基本の8項目。飲食専用の2項目は基本や統括の差し込みへ混ぜない。 */
export const BASIC_FRIEND_FIELDS = FIXED_FRIEND_FIELDS.slice(0, 8);
export const DEFAULT_ALLERGY_OPTIONS = ['卵', '乳', '小麦', 'そば', '落花生', 'えび', 'かに', 'くるみ'] as const;

/** 旧1行の値は1要素。区切りを推測して自由記入を分割しない。 */
export function allergyValues(raw: unknown): string[] {
  if (typeof raw === 'string') {
    try { const parsed: unknown = JSON.parse(raw); if (Array.isArray(parsed)) raw = parsed; }
    catch { /* 旧文字値 */ }
  }
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return [...new Set(values.filter((value): value is string => typeof value === 'string').map(value => value.trim()).filter(Boolean))];
}

export function validateAllergyValues(raw: unknown): { ok: true; values: string[] } | { ok: false; error: string } {
  let parsed = raw;
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try { parsed = JSON.parse(raw); } catch { return { ok: false, error: 'アレルギーの値を確認してください' }; }
  }
  if (parsed == null || parsed === '') return { ok: true, values: [] };
  if (typeof parsed !== 'string' && !Array.isArray(parsed)) return { ok: false, error: 'アレルギーは文字を複数選んでください' };
  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (items.length > 32 || items.some(value => typeof value !== 'string' || !value.trim() || value.trim().length > 100)) {
    return { ok: false, error: 'アレルギーは32個まで、1つ100文字以内で入力してください' };
  }
  return { ok: true, values: allergyValues(items) };
}

/** 日本の暦で満年齢を計算。暦に無い・未来の誕生日なら回答年齢を使う。 */
export function ageFromBirthday(birthday: string | null | undefined, now = new Date()): number | null {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null;
  const [year, month, day] = birthday.split('-').map(Number);
  const born = new Date(birthday + 'T00:00:00Z');
  if (born.getUTCFullYear() !== year || born.getUTCMonth() + 1 !== month || born.getUTCDate() !== day) return null;
  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const age = today.getUTCFullYear() - year -
    (today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day) ? 1 : 0);
  return age < 0 ? null : age;
}
