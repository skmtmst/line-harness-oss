import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * #975 U062: 390pxで6枚の大カードが名前・条件入力の前に積まれていた。
 * 種類は短い選択群にし、詳しい説明は選択中の1種類だけ出す。
 */
describe('コンバージョンの種類選択（#975 U062）', () => {
  it('390pxで2列の短い選択群にする', () => {
    expect(PAGE).toContain('role="radiogroup" aria-label="数えるきっかけ"')
    expect(PAGE).toContain('grid grid-cols-2 gap-2 sm:grid-cols-3')
    // 大カードの3段構成（アイコン＋題名＋説明）は使わない。
    expect(PAGE).not.toContain('md:grid-cols-3 xl:grid-cols-6')
  })

  it('説明は選択中の1種類だけ出す', () => {
    expect(PAGE).toContain('TRIGGER_CHOICES.find((choice) => choice.value === triggerKind)')
    expect(PAGE).toContain('の出来事が起きた人を数えます')
  })
})
