/**
 * 日本の祝日表。
 *
 * 出典  : 内閣府「国民の祝日について」で公開されている祝日CSV
 *         https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv
 * 対象年: 2024年〜2026年（COVERED_YEARS と一致させること）
 * 取得日: 2026-08-15
 *
 * 更新手順:
 *   1. 内閣府CSVを取得する（例年2月ごろに翌年分が追加される）
 *   2. 対象年ぶんの `YYYY-MM-DD` を HOLIDAYS に追記する
 *   3. COVERED_YEARS の上限を更新する
 *   4. `packages/shared` のテストを実行して通ることを確認する
 *
 * 外部APIへ都度問い合わせる方式は採らない。実行時の通信をなくし、
 * 判定を決定的にしてテストできるようにするため、表として持つ。
 */

/** この表が網羅している年（両端を含む）。 */
export const COVERED_YEARS = { from: 2024, to: 2026 } as const;

/**
 * 祝日（振替休日・国民の休日を含む）。内閣府CSVの日付をそのまま持つ。
 * JST の暦日を表す文字列で、タイムゾーンの概念は持たない。
 */
const HOLIDAYS: ReadonlySet<string> = new Set([
  // 2024
  '2024-01-01', '2024-01-08', '2024-02-11', '2024-02-12', '2024-02-23',
  '2024-03-20', '2024-04-29', '2024-05-03', '2024-05-04', '2024-05-05',
  '2024-05-06', '2024-07-15', '2024-08-11', '2024-08-12', '2024-09-16',
  '2024-09-22', '2024-09-23', '2024-10-14', '2024-11-03', '2024-11-04',
  '2024-11-23',
  // 2025
  '2025-01-01', '2025-01-13', '2025-02-11', '2025-02-23', '2025-02-24',
  '2025-03-20', '2025-04-29', '2025-05-03', '2025-05-04', '2025-05-05',
  '2025-05-06', '2025-07-21', '2025-08-11', '2025-09-15', '2025-09-23',
  '2025-10-13', '2025-11-03', '2025-11-23', '2025-11-24',
  // 2026
  '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20',
  '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
  '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23',
  '2026-10-12', '2026-11-03', '2026-11-23',
]);

/** 表の対象年から外れた日付を判定しようとしたときの通知先。 */
export type HolidayCoverageWarning = (message: string, isoDate: string) => void;

let warn: HolidayCoverageWarning = (message, isoDate) => {
  // 既定は console.warn。呼び出し側（Worker など）が監視に載せたい場合は
  // setHolidayCoverageWarningHandler で差し替える。
  console.warn(`[japanese-holidays] ${message} date=${isoDate}`);
};

/** 対象外の年を判定したときの通知方法を差し替える。 */
export function setHolidayCoverageWarningHandler(handler: HolidayCoverageWarning): void {
  warn = handler;
}

/**
 * 表が対象年を網羅しているか。網羅していない場合、`isHoliday` は
 * 「祝日ではない」と答えたうえで警告を出す。黙って誤判定しないための保険。
 */
export function isYearCovered(isoDate: string): boolean {
  const year = Number(isoDate.slice(0, 4));
  return Number.isFinite(year) && year >= COVERED_YEARS.from && year <= COVERED_YEARS.to;
}

/**
 * `YYYY-MM-DD`（JSTの暦日）が祝日かどうか。
 * 対象年の外は false を返しつつ警告する。呼び出し側が握りつぶさないよう、
 * 警告はハンドラ経由で必ず1回出す。
 */
export function isJapaneseHoliday(isoDate: string): boolean {
  if (!isYearCovered(isoDate)) {
    warn(
      `祝日表が対象としていない年です。祝日ではない日として扱いました。` +
        `表の更新が必要です（対象: ${COVERED_YEARS.from}〜${COVERED_YEARS.to}年）。`,
      isoDate,
    );
    return false;
  }
  return HOLIDAYS.has(isoDate);
}

/** テストと運用確認のために、表に入っている件数を返す。 */
export function holidayCount(): number {
  return HOLIDAYS.size;
}
