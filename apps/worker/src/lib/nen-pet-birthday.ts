/**
 * NEN ペットの誕生日の受け口を1つにする。
 *
 * 誕生日は「年月日（YYYY-MM-DD）」か「月日だけ（MM-DD）」を受け付ける。
 * 生まれた年が分からない子（保護犬など）も誕生日配信の対象にするためで、
 * 年齢は不明のまま「—」と出す。配信の突き合わせは最後5桁
 * （substr(birthday, -5)）で行うので両形とも同じ行へ収束する。
 *
 * 'invalid' は入力値として受け取れない形（別の文字列・実在しない日付）。
 */
export function normalizeNenPetBirthday(value: unknown): string | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return 'invalid';
  const trimmed = value.trim();
  const monthDayOnly = /^\d{2}-\d{2}$/.test(trimmed);
  // 月日だけはうるう年を付けて実在日か確かめる（02-29 は有効）。
  const normalized = monthDayOnly ? `2000-${trimmed}` : trimmed;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return 'invalid';
  const parsed = Date.parse(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return 'invalid';
  // Date.parse は存在しない日を翌月へ丸めるので、書き戻し一致を確かめる。
  if (new Date(parsed).toISOString().slice(0, 10) !== normalized) return 'invalid';
  return monthDayOnly ? trimmed : normalized;
}
