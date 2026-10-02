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
 * updated_at を版として使う更新の、次の版を返す。
 *
 * 同じミリ秒に2回書くと版が進まず、古い画面からの保存を見分けられない
 * （M507・M509・M511・M513）。現在時刻が読んだ版以下のときは読んだ版の
 * 1ms 先へ進め、版が必ず単調に進むようにする。読めない版のときは現在時刻。
 */
export function nextVersionToken(current: string | null | undefined, now: string = jstNow()): string {
  if (!current) return now;
  const currentMs = new Date(current).getTime();
  if (!Number.isFinite(currentMs)) return now;
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs) || nowMs > currentMs) return now;
  return toJstString(new Date(currentMs + 1));
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

/*
 * JSTの当月1日 00:00 を `jstNow` と同じ表記（+09:00 付き）で返す。
 * SQLite の `datetime('now','start of month')` は UTC の月初を返すため、
 * 日本時間の月初 0〜9 時に前月の記録を混ぜていた（監査 R384）。
 * `occurred_at` など JST 文字列入りの列と文字列比較できる形に揃える。
 */
export function jstMonthStartString(nowMs = Date.now()): string {
  const jst = new Date(nowMs + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  const month = String(jst.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01T00:00:00.000+09:00`;
}

/*
 * 監査 R227: 期間の境界を UTC の ISO 文字列へ揃える。
 * 記録の時刻は JST 表記（`jstNow` の `+09:00`）で、画面から来る期間も
 * JST の暦日を指す。時差の書かれた値（`Z`・`+09:00`）はそのまま、
 * 書かれていない値（`'2026-08-01'`・`'2026-08-16T23:59:59.999'`）は
 * JST として読む。読めない値は null を返す。
 */
export function jstBoundToIso(bound: string): string | null {
  const trimmed = bound.trim();
  const candidate = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed)
    ? trimmed
    : /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? `${trimmed}T00:00:00+09:00`
      : `${trimmed}+09:00`;
  const ms = Date.parse(candidate);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/*
 * 期間ウィンドウの部品をまとめて作る。
 * - `fromIso` / `toIso`: julianday へ渡す正規化済みの境界（UTC ISO）。
 * - `lo` / `hi`: 索引へ乗せるための先読み範囲。日時の列には `…Z` と
 *   `…+09:00` が混在するので文字列の大小だけでは前後を決められず、
 *   タイムゾーンの差（±14時間）に余裕を足した26時間分だけ広い日付で
 *   先に絞る。下限は空白区切りにし、'T' 以外の区切りの行を誤って外さない
 *   （空白 < 'T'）。所属の最終判定は julianday が行う。
 */
export function analyticsWindow(
  from: string,
  to: string,
): { lo: string; hi: string; fromIso: string; toIso: string } {
  const fromIso = jstBoundToIso(from) ?? from;
  const toIso = jstBoundToIso(to) ?? to;
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  // 境界が読めないときは絞り込まず、julianday だけの判定に落とす。
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { lo: '', hi: '￿', fromIso, toIso };
  }
  const margin = 26 * 60 * 60_000;
  return {
    lo: `${new Date(fromMs - margin).toISOString().slice(0, 10)} 00:00:00`,
    hi: `${new Date(toMs + margin).toISOString().slice(0, 10)}T00:00:00`,
    fromIso,
    toIso,
  };
}

/*
 * 期間ウィンドウの WHERE 断片。索引に乗る大まかな比較（先読み）と、
 * 正確な julianday 判定の2段構え。bind は `win.lo, win.hi, win.fromIso,
 * win.toIso` の順。上限は既定で開区間（<）。上限込みの窓には
 * `toInclusive: true`。
 */
export function analyticsWindowWhere(column: string, toInclusive = false): string {
  return `AND ${column} >= ? AND ${column} < ?
          AND julianday(${column}) >= julianday(?) AND julianday(${column}) ${toInclusive ? '<=' : '<'} julianday(?)`;
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
