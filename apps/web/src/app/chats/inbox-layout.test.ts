import { describe, expect, it } from 'vitest'
import { INBOX_INFO_PANEL_MIN_WIDTH, inboxThreeColumnsFit } from './inbox-layout'
describe('白い板の内幅による受信箱の3列', () => {
  it('一覧340＋顧客情報260＋トーク500を確保した境界で常設する', () => {
    expect(INBOX_INFO_PANEL_MIN_WIDTH).toBe(1100)
    expect(inboxThreeColumnsFit(1100)).toBe(true)
    expect(inboxThreeColumnsFit(1099)).toBe(false)
  })
  it('殻やサイドバーの幅を仮定せず、実際の内幅で決まる', () => {
    for (const width of [800, 1000, 1099]) expect(inboxThreeColumnsFit(width)).toBe(false)
    for (const width of [1100, 1188, 1680]) expect(inboxThreeColumnsFit(width)).toBe(true)
  })
})
