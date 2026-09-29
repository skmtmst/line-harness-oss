import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canOpenCustomerNotificationKpi, customerNotificationKpis } from './customer-kpis'

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')

/** 「送れなかった」から対応一覧へ渡す（設計 `festr`）。 */
describe('V6 LINE通知（festr）', () => {
  it('送れなかった帯から、対応一覧へ渡す', () => {
    /*
      数を出すだけで終わらせない。「要確認 2件」と言われても、
      その2件がどれかを探す場所が無かった。
    */
    const failed = customerNotificationKpis({
      ready: true, settingsCount: 4, enabledCount: 3, sentToday: 20, sentBreakdown: '注文 12・発送 8', failed: 2, quota: null,
    }).find((kpi) => kpi.label === '送れなかった')!
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
      ready: true, settingsCount: 0, enabledCount: 0, sentToday: 0, sentBreakdown: '', failed: 0, quota: null,
    }).find((kpi) => kpi.label === '送れなかった')!
    expect(zero.value).toBe(0)
    expect(canOpenCustomerNotificationKpi(zero)).toBe(false)
  })

  it('数えていないものを0で埋めない', () => {
    const unavailable = customerNotificationKpis({
      ready: false, settingsCount: 0, enabledCount: 0, sentToday: null, sentBreakdown: '', failed: null, quota: null,
    })
    expect(unavailable.every((kpi) => kpi.value === null)).toBe(true)
    expect(unavailable.some(canOpenCustomerNotificationKpi)).toBe(false)
    expect(PAGE).toContain("value === null ? '—' : value")
  })

  it('取得できた実値0は未取得と混ぜない', () => {
    const ready = customerNotificationKpis({
      ready: true, settingsCount: 0, enabledCount: 0, sentToday: 0, sentBreakdown: '', failed: 0,
      quota: { state: 'available', total: 500, used: 0, remaining: 500, asOf: '2026-09-15T00:00:00Z' },
    })
    expect(ready.find((kpi) => kpi.label === '今月使った')?.value).toBe(0)
    expect(ready.find((kpi) => kpi.label === '今月残り')?.value).toBe(500)
  })

  it('LINEが送信枠を返せないときは0を作らず取得不能理由を出す', () => {
    const kpis = customerNotificationKpis({
      ready: true, settingsCount: 1, enabledCount: 1, sentToday: 3, sentBreakdown: '注文 3', failed: 0,
      quota: {
        state: 'unavailable', total: null, used: null, remaining: null, asOf: null,
        reason: 'LINEから送信枠を取得できませんでした',
      },
    })
    const quota = kpis.filter((kpi) => kpi.label.startsWith('今月'))
    expect(quota.map((kpi) => kpi.value)).toEqual([null, null, null])
    expect(quota.every((kpi) => kpi.note === 'LINEから送信枠を取得できませんでした')).toBe(true)
  })

  it('上限なし契約も取得不能と混ぜず、実使用数を表示する', () => {
    const kpis = customerNotificationKpis({
      ready: true, settingsCount: 1, enabledCount: 1, sentToday: 3, sentBreakdown: '注文 3', failed: 0,
      quota: { state: 'unlimited', total: null, used: 123, remaining: null, asOf: '2026-09-15T00:00:00Z' },
    })
    expect(kpis.find((kpi) => kpi.label === '今月の送信枠')?.value).toBe('上限なし')
    expect(kpis.find((kpi) => kpi.label === '今月使った')?.value).toBe(123)
    expect(kpis.find((kpi) => kpi.label === '今月残り')?.value).toBe('上限なし')
  })

  it('アカウント切替時に前の集計をその場で捨てる', () => {
    expect(PAGE).toContain('setSettings([])')
    expect(PAGE).toContain('setOverview(null)')
    expect(PAGE).toContain('setQuota(null)')
    expect(PAGE).toContain('generation !== loadGeneration.current')
    expect(PAGE).toContain('generation === loadGeneration.current')
  })
})
