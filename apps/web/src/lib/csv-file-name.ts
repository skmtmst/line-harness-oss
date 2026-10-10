import { jstDate } from './jst-datetime'
const CSV_FEATURE_NAMES: Record<string, string> = {
  'booking-ledger': '予約台帳', applicants: 'イベント申込者', 'webinar-participants': '動画セミナー参加者',
  'friends': '友だち', 'automation-runs': 'オートメーションの実行履歴', 'automations-runs': 'オートメーションの実行履歴',
}
export const CSV_EXPORT_LABEL = 'CSVで書き出す'
/** 保存する日の日本時間を使う。既に付いている日付と拡張子は二重にしない。 */
export function csvFileName(feature: string, now = new Date()): string {
  const base = feature.trim().replace(/\.csv$/i, '').replace(/[_-]\d{4}-\d{2}-\d{2}$/, '')
  const label = (CSV_FEATURE_NAMES[base] ?? base).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || '書き出し'
  const date = jstDate(now)
  return `${label}_${date}.csv`
}
