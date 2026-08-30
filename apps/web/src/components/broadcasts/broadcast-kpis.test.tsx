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

  it('設計どおりの4枚を、設計の順で出す', () => {
    // 設計 `q76C35` は 予約中 → 下書き → 今月の配信 → 平均開封率。
    expect(buildBroadcastKpiCards(null).map((card) => card.title))
      .toEqual(['予約中', '下書き', '今月の配信', '平均開封率'])
  })

  it('集計の一部が欠けてもundefinedを文へつながない', () => {
    const cards = buildBroadcastKpiCards({
      thisMonth: 12,
      openRate: 69.4,
    })

    expect(cards.find((card) => card.title === '予約中')?.value).toBeNull()
    expect(cards.find((card) => card.title === '今月の配信')?.detail).toBe('—')
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

    expect(cards.find((card) => card.title === '予約中')?.value).toBe(0)
    expect(cards.find((card) => card.title === '今月の配信')?.value).toBe(0)
    expect(cards.find((card) => card.title === '今月の配信')?.detail).toBe('0人へ到達')
    // 開封率だけは取得できていない。0% と混ぜない。
    expect(cards.find((card) => card.title === '平均開封率')?.value).toBeNull()
  })

  it('下書きの件数は作らず、未取得だと書く', () => {
    /*
     * 一覧は全件返るので数えられそうに見えるが、一覧はLINEアカウントで
     * 絞れるのに集計は絞らない。基準の違う数を同じ帯に並べない。
     */
    const cards = buildBroadcastKpiCards({
      thisMonth: 12, scheduled: 4, delivered: 1842, failed: 3, openRate: 69.4,
    })
    const draft = cards.find((card) => card.title === '下書き')

    expect(draft?.value).toBeNull()
    expect(draft?.detail).toContain('未取得')
  })
})
