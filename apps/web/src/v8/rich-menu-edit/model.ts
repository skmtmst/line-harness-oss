/*
 * ★V8 リッチメニューの詳細（hKr8f）で使う小さな計算。画面から切り出して試験で確かめる。
 */
import type { RichMenuPublishRun } from '@/lib/api'

export type ProgressStep = { key: string; label: string; status: 'done' | 'failed' | 'running' | 'pending' | 'skipped' }
export type ReconcileDiff = { kind: string; detail: string; pageId?: string; richMenuId?: string; fix?: { label: string; action: string } }

/** 公開の進みの段の呼び名（今の画面と同じ：手を付けていない段は「しない」）。 */
export function progressStatusText(status: ProgressStep['status']): string {
  if (status === 'done') return '済み'
  if (status === 'failed') return '失敗'
  if (status === 'running') return '実行中'
  return 'しない'
}

/** 出す相手：すべての友だち（既定）・条件に当てはまる友だち・登録だけ。 */
export function audienceOf(group: { isDefaultForAll: boolean; targetingEnabled: boolean }): 'all' | 'targeted' | 'none' {
  if (group.isDefaultForAll) return 'all'
  if (group.targetingEnabled) return 'targeted'
  return 'none'
}

/** 公開の版が誰に出る版だったか。読めない版は「—」と濁す（でっち上げない）。 */
export function runAudienceText(run: RichMenuPublishRun): string {
  const version = run.version
  if (version?.isDefaultForAll === true) return 'すべての友だち（既定）'
  if (version?.targetingEnabled === true) return '条件に当てはまる友だち'
  if (version?.isDefaultForAll === false && version?.targetingEnabled === false) return '登録だけ'
  return '—'
}

/** 「10/1 10:45」（日本時間）。timeOnly は「10:46」。 */
export function runStamp(value: string, timeOnly = false): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).map((p) => [p.type, p.value]),
  )
  return timeOnly ? `${parts.hour}:${parts.minute}` : `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`
}
