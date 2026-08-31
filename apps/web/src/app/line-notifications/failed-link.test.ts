import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')

/** 「要確認」から送れなかったものへ渡す（設計 `festr`）。 */
describe('V6 LINE通知（festr）', () => {
  it('要確認の帯から、送れなかったものへ渡す', () => {
    /*
      数を出すだけで終わらせない。「要確認 2件」と言われても、
      その2件がどれかを探す場所が無かった。
    */
    expect(PAGE).toContain("'/line-notifications?tab=failures'")
    expect(PAGE).toContain('送れなかったものを見る')
  })

  it('渡す先のタブが実在する', () => {
    // 行き先の無いリンクを作らない。
    expect(PAGE).toContain("{ key: 'failures', label: '送れなかったもの' }")
    expect(PAGE).toContain("tab === 'failures'")
  })

  it('0件のときは押せる形にしない', () => {
    // 押しても何も無い。押せる見た目にするのは嘘。
    expect(PAGE).toContain('href && value > 0')
  })

  it('数えていないものを0で埋めない', () => {
    // `overview` が読めていないときに 0件 と言い切らないことを見張る。
    expect(PAGE).toContain('overview?.failed ?? 0')
  })
})
