export const MAX_LIST_LIMIT = 200;

/** 管理画面の一覧件数を安全な正の整数へそろえる。 */
export function listLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_LIST_LIMIT);
}

/** OFFSET は不正値や負数を先頭ページへ戻す。 */
export function listOffset(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function listPage(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 1;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}
