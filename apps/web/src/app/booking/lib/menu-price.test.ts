import { describe, expect, it } from 'vitest'
import { menuPriceLabel } from './menu-price'

describe('R309 予約メニューの料金表示', () => {
  it('お問い合わせは金額を出さず「お問い合わせ」', () => {
    expect(menuPriceLabel({ price_mode: 'inquiry', base_price: 0 })).toBe('お問い合わせ')
  })

  it('金額0は「無料」', () => {
    expect(menuPriceLabel({ price_mode: 'free', base_price: 0 })).toBe('無料')
    // 料金の形が無い古い応答でも0は無料と読む。
    expect(menuPriceLabel({ price_mode: undefined, base_price: 0 })).toBe('無料')
  })

  it('固定料金は円つき', () => {
    expect(menuPriceLabel({ price_mode: 'fixed', base_price: 8000 })).toBe('¥8,000')
  })
})
