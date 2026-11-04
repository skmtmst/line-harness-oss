import type { Dispatch, SetStateAction } from 'react'
import type { BroadcastBubble } from '@/lib/api'
import { MAX_BUBBLES } from './message-limits'

/** 吹き出しの入口では置き換え、作り方の入口では空欄か末尾へ追加する。 */
export function placeBroadcastTemplate(bubble: BroadcastBubble, { index, bubbles, setBubbles, updateBubble, setError }: {
  index: number | null
  bubbles: BroadcastBubble[]
  setBubbles: Dispatch<SetStateAction<BroadcastBubble[]>>
  updateBubble: (target: number | string, bubble: BroadcastBubble, restoreKind?: boolean) => void
  setError: (error: string) => void
}) {
  if (index !== null && bubbles[index]) {
    updateBubble(index, { ...bubble, id: bubbles[index].id }, false)
    return
  }
  const empty = bubbles.length === 1 && bubbles[0]?.type === 'text' && !String(bubbles[0].content.text ?? '').trim()
  if (!empty && bubbles.length >= MAX_BUBBLES) {
    setError(`メッセージは${MAX_BUBBLES}通までです。追加する前に、不要なメッセージを削除してください。`)
    return
  }
  setBubbles(items => empty ? [bubble] : [...items, bubble])
}
