import type { ApiBroadcast } from '@/lib/api'

export type BroadcastSendChoice = 'unselected' | 'now' | 'scheduled' | 'spread' | 'optimal'
export type BroadcastSendMode = Exclude<BroadcastSendChoice, 'spread'>
export type BroadcastSpreadStart = 'now' | 'scheduled'

const choices: ReadonlyArray<string> = ['unselected', 'now', 'scheduled', 'spread', 'optimal']

/** 画面用の選択と書きかけを戻す。印のない旧下書きの即時配信は選び直す。 */
export function readBroadcastSchedule(draft: ApiBroadcast) {
  const stored = draft.draftPayload
  // 通常の確定では下書きの印は更新されない。配送の現在値を先に読む。
  const minutes = Number(draft.stealthSpreadMinutes ?? stored?.stealthSpreadMinutes ?? 0)
  const deliveryMinutes = broadcastSpreadMinutes(String(minutes))
  const hint = stored?.draftSendChoice
  const choice = typeof hint === 'string' && choices.includes(hint) ? hint as BroadcastSendChoice : null
  const hasSchedule = Boolean(draft.scheduledAt)
  const startHint = stored?.draftSpreadStart
  const spreadStart: BroadcastSpreadStart = hasSchedule ? 'scheduled'
    : startHint === 'scheduled' ? 'scheduled' : deliveryMinutes > 0 ? 'now'
      : startHint === 'now' ? 'now' : 'scheduled'
  // 値が空の書きかけだけ印を使い、今すぐへ化けさせない。
  const sendChoice: BroadcastSendChoice = deliveryMinutes > 0 ? 'spread' : hasSchedule ? 'scheduled' : choice ?? 'unselected'
  const spreadMinutes = deliveryMinutes > 0 ? String(deliveryMinutes)
    : choice === 'spread' && typeof stored?.draftSpreadMinutes === 'string' ? stored.draftSpreadMinutes : '30'
  return { sendChoice, spreadStart, spreadMinutes,
    scheduledDate: !hasSchedule && choice && typeof stored?.draftScheduledDate === 'string' ? stored.draftScheduledDate : null,
    scheduledTime: !hasSchedule && choice && typeof stored?.draftScheduledTime === 'string' ? stored.draftScheduledTime : null,
  }
}

/** 配送に使える分数。未入力は下書きにだけ残し、配送値には混ぜない。 */
export function broadcastSpreadMinutes(value: string): number {
  const minutes = Number(value)
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 720 ? minutes : 0
}

export function broadcastSendLabel(mode: BroadcastSendMode): string {
  return mode === 'scheduled' ? 'この内容で予約する' : mode === 'now' ? '今すぐ送る' : '送信設定を確認する'
}
