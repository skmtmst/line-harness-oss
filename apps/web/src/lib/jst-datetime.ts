/**
 * datetime-localの入力（タイムゾーンなし）を日本時間としてUTCへ直す。
 * ブラウザの地域に左右されず、JST固定で保存する。
 */
export function datetimeLocalJstToUtcIso(value: string): string {
  const trimmed = value.trim();
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(trimmed)) return new Date(trimmed).toISOString();
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed}:00`
    : trimmed;
  return new Date(`${withSeconds}+09:00`).toISOString();
}
