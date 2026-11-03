import type { BroadcastBubble } from '@/lib/api'
import { bubblesError } from './broadcast-form-model'

export const B_NON_TEXT = 'B案の文字以外は保存されません。文字だけにしてから保存してください'
export const B_DRAFT_UNAVAILABLE = 'B案は下書きに保存できません。B案を消してから保存してください。'

/** 文字だけを受け取るA/B APIへ、欠落する入力を渡さない。 */
export function broadcastAbProblem(a: BroadcastBubble[], b: BroadcastBubble[] | null, enabled: boolean, all: boolean): string {
  if (!b) return ''
  if (b.some(bubble => bubble.type !== 'text')) return B_NON_TEXT
  if (enabled && a.some(bubble => bubble.type !== 'text')) return 'A/B テストでは今は文字だけ送れます。文字以外を外すか、A/B をやめてください'
  if (enabled && a.map(bubble => String(bubble.content.text ?? '')).join('\n\n').trim().length > 5000) return 'A案の文字は合計5000文字以内にしてください。'
  if (enabled && all) return '友だち全員への配信ではA/Bを使えません。B案を消してください。'
  if (!enabled) return ''
  if (b.length === 0) return 'B案にテキストを入力してください。'
  const problem = bubblesError(b)
  if (problem) return `B案：${problem}`
  if (b.map(bubble => String(bubble.content.text ?? '')).join('\n\n').trim().length > 5000) return 'B案の文字は合計5000文字以内にしてください。'
  return ''
}
