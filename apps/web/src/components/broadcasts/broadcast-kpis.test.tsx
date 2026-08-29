import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BroadcastKpiValue, buildBroadcastKpiCards } from './broadcast-kpi-values'

describe('一斉配信のKPI', () => {
  it('取得できて0件なら0件と表示する', () => {
    const html = renderToStaticMarkup(<BroadcastKpiValue value={0} unit="件" />)

    expect(html).toContain('>0<')
    expect(html).toContain('>件<')
  })

  it('未取得なら単位を付けずダッシュだけを表示する', () => {
    const html = renderToStaticMarkup(<BroadcastKpiValue value={null} unit="件" />)

    expect(html).toContain('>—<')
    expect(html).not.toContain('>0<')
    expect(html).not.toContain('>件<')
  })

  it('集計の一部が欠けてもundefinedを文へつながない', () => {
    const cards = buildBroadcastKpiCards({
      thisMonth: 12,
      delivered: 1842,
      openRate: 69.4,
    })

    expect(cards.find((card) => card.title === '今月の配信')?.detail).toBe('—')
    expect(cards.find((card) => card.title === '到達')?.detail).toBe('—')
    expect(JSON.stringify(cards)).not.toContain('undefined')
  })

  it('取得できた実値0は未取得と区別する', () => {
    const cards = buildBroadcastKpiCards({
      thisMonth: 0,
      scheduled: 0,
      delivered: 0,
      failed: 0,
      openRate: null,
    })

    expect(cards.find((card) => card.title === '今月の配信')?.detail).toBe('予約中 0件')
    expect(cards.find((card) => card.title === '到達')?.detail).toBe('失敗 0通')
  })
})
