import type { D1Database } from '@cloudflare/workers-types';

/** JST offset: UTC+9 in milliseconds */
const JST_OFFSET_MS = 9 * 60 * 60_000;

export const MAX_LIST_LIMIT = 200;

/** DB helper を直接呼んでも一覧が無制限にならないようにする。 */
export function boundedListLimit(value: number | undefined, fallback: number): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) return fallback;
  return Math.min(value!, MAX_LIST_LIMIT);
}

export function nonNegativeListOffset(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value! : 0;
}

/**
 * Returns current time as JST ISO 8601 string with +09:00 offset.
 * Format: YYYY-MM-DDTHH:mm:ss.sss+09:00
 *
 * All timestamps in this project are standardized to JST.
 * The +09:00 suffix ensures new Date() parses correctly for epoch comparisons.
 */
export function jstNow(): string {
  return toJstString(new Date());
}

/**
 * Convert a Date object to JST ISO 8601 string with +09:00 offset.
 * Format: YYYY-MM-DDTHH:mm:ss.sss+09:00
 */
export function toJstString(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, -1) + '+09:00';
}

/**
 * Compare two timestamp strings (any format) as epoch milliseconds.
 * Handles both Z and +09:00 formats correctly.
 */
export function isTimeBefore(a: string, b: string): boolean {
  return new Date(a).getTime() <= new Date(b).getTime();
}

/**
 * JSTの暦日（YYYY-MM-DD）。DBへ入る時刻はJST文字列（`jstNow`）なので、
 * 頭10文字と突き合わせて期間を切る。SQLiteの `date('now')` はUTCで
 * 9時間ずれるため、「今日」の境目の集計には使わない。
 */
export function jstDateString(offsetDays = 0, nowMs = Date.now()): string {
  const jst = new Date(nowMs + JST_OFFSET_MS + offsetDays * 86_400_000);
  return jst.toISOString().slice(0, 10);
}

/** 暦日の翌日（YYYY-MM-DD）。`col >= day AND col < next` の半開区間に使う。 */
export function nextDateString(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * 表があるかを確かめる。決まりの表が無い古いスキーマ（最小構成の単体試験など）
 * では、新しい表を読む処理を従来の動きに落とすために使う。
 * 表が無いこと自体は異常ではないので、失敗時は false を返す。
 */
export async function dbTableExists(db: D1Database, name: string): Promise<boolean> {
  try {
    const row = await db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .bind(name)
      .first<{ ok: number }>();
    return !!row;
  } catch {
    return false;
  }
}
