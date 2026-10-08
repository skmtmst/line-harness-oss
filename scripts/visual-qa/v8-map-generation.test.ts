import { describe, expect, it } from 'vitest'
// @ts-expect-error JS tool
import { buildRows } from './build-v8-board-to-code.mjs'
import map from './v8-design-map.json'

describe('ROOT-19 二つの対応表を同じURLから作る', () => {
  it('古い文書のURLではなく撮影の対応表の実URLを使う', () => {
    const rows = buildRows(map, [['V8', 'WQmep', 'ダッシュボード', '/notifications'], ['V8', 'q5gbcM', '友だち情報欄', '/tags']])
    expect(rows.map((r: { url: string }) => r.url)).toEqual(['/', '/tags?tab=fields'])
  })
  it('予約設定の板は実際のタブで開く', () => {
    for (const [id, tab] of Object.entries({ KRgTQ: 'holidays', VFxWU: 'hours', ZyDd6: 'channels', x1OZS6: 'rules', yRPxl: 'hours' })) {
      expect(map.boards[id as keyof typeof map.boards].url).toBe(`/booking/menus?tab=${tab}`)
    }
  })
  it('場所が決まっていない板を古い文書のURLで撮れるようにしない', () => {
    const rows = buildRows({ boards: { unknown: { name: '不明', route: null, url: null } } }, [['V8', 'unknown', '不明', '/notifications']])
    expect(rows[0].url).toBeNull()
  })
})
