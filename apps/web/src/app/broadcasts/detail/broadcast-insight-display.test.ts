import { describe, expect, it } from 'vitest'
import { clickInsightDetail, formatBroadcastDateTime, openInsightDetail } from './broadcast-insight-display'

describe('一斉配信の日時表示', () => {
  it('日本時間で表示し、未取得や壊れた値をダッシュにする', () => {
    expect(formatBroadcastDateTime('2026-08-20T03:00:00.000Z')).toBe('2026/08/20 12:00')
    expect(formatBroadcastDateTime(null)).toBe('—')
    expect(formatBroadcastDateTime('not-a-date')).toBe('—')
  })
})

describe('一斉配信の開封集計', () => {
  it('LINE集計の到達数を母数として明記する', () => {
    expect(openInsightDetail({
      delivered: 4_012,
      uniqueImpression: 2_410,
      uniqueClick: 618,
      suppressedByAudienceSize: false,
    })).toBe('LINE集計の到達 4,012件のうち 60.1%')
  })

  it('未取得と実値0を分ける', () => {
    expect(openInsightDetail(null)).toBe('—')
    expect(openInsightDetail({ delivered: null, uniqueImpression: 0, uniqueClick: 0, suppressedByAudienceSize: false })).toBe('—')
    expect(openInsightDetail({ delivered: 0, uniqueImpression: 0, uniqueClick: 0, suppressedByAudienceSize: false }))
      .toBe('LINE集計の到達 0件（割合は算出できません）')
  })

  it('少人数で取得できない理由を維持する', () => {
    expect(openInsightDetail({ delivered: 12, uniqueImpression: null, uniqueClick: null, suppressedByAudienceSize: true }))
      .toBe('配信先が20人未満のため取れません')
  })
})

describe('一斉配信のクリック集計', () => {
  it('開封ではなくLINE集計の到達数を母数にする', () => {
    // 開封 2,410 を母数にすると 25.6% になる。保存側は到達を母数にしており、
    // 画面だけ別の母数で割ると、どこにも無い数を作ることになる。
    expect(clickInsightDetail({
      delivered: 4_012,
      uniqueImpression: 2_410,
      uniqueClick: 618,
      suppressedByAudienceSize: false,
    })).toBe('LINE集計の到達 4,012件のうち 15.4%')
  })

  it('未取得と実値0を分ける', () => {
    expect(clickInsightDetail(null)).toBe('—')
    expect(clickInsightDetail({ delivered: 4_012, uniqueImpression: 2_410, uniqueClick: null, suppressedByAudienceSize: false }))
      .toBe('—')
    expect(clickInsightDetail({ delivered: 0, uniqueImpression: 0, uniqueClick: 0, suppressedByAudienceSize: false }))
      .toBe('LINE集計の到達 0件（割合は算出できません）')
  })

  it('少人数で取得できない理由を開封とそろえる', () => {
    expect(clickInsightDetail({ delivered: 12, uniqueImpression: null, uniqueClick: null, suppressedByAudienceSize: true }))
      .toBe('配信先が20人未満のため取れません')
  })
})
