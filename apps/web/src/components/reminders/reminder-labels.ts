import type { ReminderDraftSettings, ReminderStopConditions } from '@line-crm/shared'
import { describeReminderTiming } from '@line-crm/shared'

/** 起点の種類を画面用の言葉へ。固定の「予約日時」と見せかけず実値を返す。 */
export function reminderTriggerLabel(triggerType: ReminderDraftSettings['triggerType']): string {
  switch (triggerType) {
    case 'booking':
      return '予約日時'
    case 'event':
      // #996 DEEP-04: event起点は「イベントへの予約の開始日時」。回答フォームの
      // 回答日ではないので、保存される意味と同じ名前にそろえる。
      return 'イベントの予約日時'
    case 'friend_field':
      return '友だち情報欄の日付'
    default:
      return '手動登録'
  }
}

/**
 * 停止条件を1行で説明する。0件・未取得・値ありを分ける。
 * 公開版スナップショットが無いなど、値そのものが取れないときは '未取得'。
 */
export function reminderStopSummary(stop: ReminderStopConditions | null | undefined): string {
  if (!stop) return '未取得'
  const labels: string[] = []
  if (stop.bookingCancelled) labels.push('予約取消で即時停止')
  if (stop.supportMarkCompleted) labels.push('対応完了で残りを停止')
  if (typeof stop.daysAfterTarget === 'number') labels.push(`基準日から${stop.daysAfterTarget}日後に自動終了`)
  if (stop.friendBlocked) labels.push('ブロックで即時停止')
  return labels.length > 0 ? labels.join('・') : '自動停止なし'
}

/** 通知ステップを「1日前の18:00・1時間前」のように実値で並べる。 */
export function reminderStepTimings(settings: ReminderDraftSettings): string {
  if (settings.steps.length === 0) return '通知なし'
  return settings.steps.map((step) => describeReminderTiming(step, settings.deliveryMode)).join('・')
}

/** 最初に届く通の本文。stableStepId があればその通、なければ先頭の通。 */
export function firstReminderStepMessage(settings: ReminderDraftSettings, stableStepId?: string | null): string {
  const step =
    (stableStepId ? settings.steps.find((candidate) => candidate.stableStepId === stableStepId) : undefined) ??
    settings.steps[0]
  return step?.messageContent ?? ''
}

export interface ReminderPlaceholder {
  token: string;
  source: string;
  testValue: string;
}

function placeholderSource(key: string): string {
  if (key === 'name') return '友だちのLINE表示名'
  if (key === 'uid') return 'LINEユーザーID'
  if (key === 'friend_id') return '友だちID'
  if (key === 'ref') return '友だちの紹介コード'
  if (key.startsWith('field.')) return '友だち情報欄'
  if (key.startsWith('var.')) return '共通変数'
  if (key.startsWith('metadata.')) return '友だちのメタデータ'
  return '送信日時を起点に計算'
}

const PLACEHOLDER_PATTERN = /\{\{(name|uid|friend_id|ref|date|days_until:[^}]+|field\.[a-z0-9_]+|var\.[a-z0-9_]+|metadata\.[^}]+)\}\}/g

/**
 * 本文に実際に書かれている差し込みだけを拾う。
 * 実装に無い変数名（{{meet_datetime}} など）は置き換わらずそのまま届くため、
 * 確認表に「取得元」付きで並べると嘘になる。拾わない。
 */
export function reminderPlaceholders(settings: ReminderDraftSettings, recipientName: string | null): ReminderPlaceholder[] {
  const seen = new Map<string, ReminderPlaceholder>()
  for (const step of settings.steps) {
    for (const match of (step.messageContent ?? '').matchAll(PLACEHOLDER_PATTERN)) {
      const key = match[1]
      const token = `{{${key}}}`
      if (seen.has(token)) continue
      seen.set(token, {
        token,
        source: placeholderSource(key),
        testValue: key === 'name' ? recipientName ?? 'テスト送信先の表示名' : '送信先の実値を使用',
      })
    }
  }
  return [...seen.values()]
}
