/** フォーム・情報欄・要点の欄が共通で使う10項目。IDは配布先に持ち込まない。 */
export const FIXED_FRIEND_FIELDS = [
  { key: 'name', label: '名前', type: 'text', format: 'none' },
  { key: 'kana', label: 'ふりがな', type: 'text', format: 'kana' },
  { key: 'birthday', label: '生年月日', type: 'date', format: 'none' },
  { key: 'age', label: '年齢', type: 'text', format: 'integer' },
  { key: 'email', label: 'メール', type: 'text', format: 'email' },
  { key: 'tel', label: '電話', type: 'text', format: 'tel' },
  { key: 'address', label: '住所', type: 'address', format: 'none' },
  { key: 'allergy', label: 'アレルギー', type: 'text', format: 'none' },
  { key: 'anniversary', label: '記念日', type: 'date', format: 'none' },
  { key: 'seat_preference', label: '席の好み', type: 'text', format: 'none' },
] as const;
export type FixedFriendFieldKey = typeof FIXED_FRIEND_FIELDS[number]['key'];
export const isFixedFriendFieldKey = (key: unknown): key is FixedFriendFieldKey =>
  FIXED_FRIEND_FIELDS.some(field => field.key === key);

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
