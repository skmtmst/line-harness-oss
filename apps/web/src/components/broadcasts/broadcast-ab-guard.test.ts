import { describe, expect, it } from 'vitest'
import type { BroadcastBubble } from '@/lib/api'
import { broadcastAbProblem, B_NON_TEXT } from './broadcast-ab-guard'

const text = (value: string): BroadcastBubble => ({ id: value, type: 'text', content: { text: value } })
const rich: BroadcastBubble = { id: 'rich', type: 'rich_message', content: {} }
describe('A/B の保存前検査', () => {
  it('B案に文字以外があると必ず止める', () => {
    expect(broadcastAbProblem([text('A')], [rich], true, false)).toBe(B_NON_TEXT)
  })
  it('A/Bが有効ならA案の文字以外も止め、通常配信では止めない', () => {
    expect(broadcastAbProblem([rich], [text('B')], true, false)).toContain('A/B テストでは今は文字だけ')
    expect(broadcastAbProblem([rich], null, false, false)).toBe('')
  })
  it('B案の空欄と合計5000文字超、全員宛てのA/Bを止める', () => {
    expect(broadcastAbProblem([text('A')], [text('')], true, false)).toContain('B案')
    expect(broadcastAbProblem([text('A')], [text('x'.repeat(2500)), text('y'.repeat(2500))], true, false)).toContain('5000')
    expect(broadcastAbProblem([text('x'.repeat(2500)), text('y'.repeat(2500))], [text('B')], true, false)).toContain('A案の文字は合計5000')
    expect(broadcastAbProblem([text('A')], [text('B')], true, true)).toContain('B案を消してください')
  })
})
