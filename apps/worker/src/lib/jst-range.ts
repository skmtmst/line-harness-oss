/**
 * 日本時間で「集計する期間」を出す。
 *
 * 期間を文字列で持つのは、DB の日時が日本時間の ISO 文字列だから
 * （`2026-08-20T01:23:45.678`）。辞書順が時系列順になるので、そのまま
 * 大小で比べられる。
 */

/**
 * 月初から翌月初までの半開区間を返す。ダッシュボードの月の前方一致と同じ範囲を、索引が使える比較で扱う。
 * 辞書順を時系列順と一致させるため、月はゼロ埋めする。
 */
export function currentMonthRange(nowJst: string): { from: string; to: string } {
  const year = Number(nowJst.slice(0, 4));
  const month = Number(nowJst.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, '0');
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    from: `${year}-${pad(month)}-01T00:00:00.000`,
    to: `${nextYear}-${pad(nextMonth)}-01T00:00:00.000`,
  };
}
