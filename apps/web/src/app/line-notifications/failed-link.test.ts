import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canOpenCustomerNotificationKpi, customerNotificationKpis } from './customer-kpis'

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')

/** 「要確認」から送れなかったものへ渡す（設計 `festr`）。 */
describe('V6 LINE通知（festr）', () => {
  it('要確認の帯から、送れなかったものへ渡す', () => {
    /*
      数を出すだけで終わらせない。「要確認 2件」と言われても、
      その2件がどれかを探す場所が無かった。
    */
    const failed = customerNotificationKpis({
      ready: true, settingsCount: 4, enabledCount: 3, processed: 20, failed: 2,
    }).find((kpi) => kpi.label === '要確認')!
    expect(failed.href).toBe('/line-notifications?tab=failures')
    expect(canOpenCustomerNotificationKpi(failed)).toBe(true)
    expect(PAGE).toContain('送れなかったものを見る')
    expect(PAGE).toContain('router.replace(href)')
  })

  it('渡す先のタブが実在する', () => {
    // 行き先の無いリンクを作らない。
    expect(PAGE).toContain("{ key: 'failures', label: '送れなかったもの' }")
    expect(PAGE).toContain("tab === 'failures'")
  })

  it('0件のときは押せる形にしない', () => {
    // 押しても何も無い。押せる見た目にするのは嘘。
    const zero = customerNotificationKpis({
      ready: true, settingsCount: 0, enabledCount: 0, processed: 0, failed: 0,
    }).find((kpi) => kpi.label === '要確認')!
    expect(zero.value).toBe(0)
    expect(canOpenCustomerNotificationKpi(zero)).toBe(false)
  })

  it('数えていないものを0で埋めない', () => {
    const unavailable = customerNotificationKpis({
      ready: false, settingsCount: 0, enabledCount: 0, processed: null, failed: null,
    })
    expect(unavailable.every((kpi) => kpi.value === null)).toBe(true)
    expect(unavailable.some(canOpenCustomerNotificationKpi)).toBe(false)
    expect(PAGE).toContain("value === null ? '—' : value")
  })

  it('取得できた実値0は未取得と混ぜない', () => {
    const ready = customerNotificationKpis({
      ready: true, settingsCount: 0, enabledCount: 0, processed: 0, failed: 0,
    })
    expect(ready.every((kpi) => kpi.value === 0)).toBe(true)
  })

  it('アカウント切替時に前の集計をその場で捨てる', () => {
    expect(PAGE).toContain('setSettings([])')
    expect(PAGE).toContain('setOverview(null)')
    expect(PAGE).toContain('generation !== loadGeneration.current')
    expect(PAGE).toContain('generation === loadGeneration.current')
  })
})
