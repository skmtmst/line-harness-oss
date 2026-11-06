/*
 * マイル履歴の日付条件の検証（R304）。
 *
 * 開始日が終了日より後だと Worker が 400 で拒否するが、画面が日付を
 * 確かめずに取りに行き、一律の取得失敗として見せていた。入力を直す
 * 必要があるのに通信障害と受け取り、無効な再読み込みを繰り返す。
 * 逆転しているときは取りに行かず、開始日・終了日のそばへ理由を出す。
 * 同日・片側だけ・正しい範囲はそのまま取得する。
 */

/** 逆転しているときの文。欄の下と一覧の案内の両方で同じ文を使う。 */
export const HISTORY_PERIOD_ERROR = '開始日は終了日より前の日付を入力してください'

/**
 * 日付条件を確かめる。`YYYY-MM-DD` 同士は文字の比較で前後が分かる。
 * おかしいときだけ理由を返し、正しいときは null。
 */
export function validateHistoryPeriod(from: string, to: string): string | null {
  if (from && to && from > to) return HISTORY_PERIOD_ERROR
  return null
}
