import type {
  AnalyticsReportDelivery,
  AnalyticsReportRun,
  RecentOneTimeReport,
} from '@/lib/api'

export type { AnalyticsReportDelivery, AnalyticsReportRun, RecentOneTimeReport }

export type AnalyticsReportRunState = AnalyticsReportRun['state']

const CHANNEL_LABELS: Record<string, string> = {
  dashboard: '管理画面のお知らせ',
  email: 'メール',
  line: 'LINE',
}

export function deliveryChannelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel
}

const RUN_STATE_LABELS: Record<AnalyticsReportRunState, string> = {
  running: '送信中',
  available: '送信済み',
  partial: '一部だけ送信',
  unavailable: '未取得',
  failed: '失敗',
}

/**
 * 実行記録の状態を運用者の言葉で出す（R454）。
 *
 * 内部の符号（error_code）は出さず、次にどうするかが分かる文にする。
 */
export function runStateLabel(state: AnalyticsReportRunState): string {
  return RUN_STATE_LABELS[state] ?? state
}

/**
 * 実行全体の失敗理由を運用者の言葉で出す（R454）。
 *
 * 送達が確定していない中断は「送達不明」として、安易な送り直しを
 * 促さない文にする。
 */
export function runErrorLabel(errorCode: string | null, state: AnalyticsReportRunState): string | null {
  if (state !== 'failed') return null
  switch (errorCode) {
    case 'worker_interrupted':
      return '送信の途中で止まりました（送達不明）。届いたか分からない宛先へは送り直さず、確認してから判断してください。'
    case 'schedule_changed_before_send':
      return '送る直前に内容が変わったため、旧設定では送りませんでした。'
    case null:
    case undefined:
      return '送信に失敗しました。'
    default:
      return `送信に失敗しました（${errorCode}）。`
  }
}

export function deliveryStatusLabel(status: AnalyticsReportDelivery['status']): string {
  switch (status) {
    case 'sent': return '送信済み'
    case 'failed': return '失敗'
    case 'skipped': return '送らず'
  }
}
