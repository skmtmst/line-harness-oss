import { describe, expect, it } from 'vitest'
import { openInsightDetail } from './broadcast-insight-display'

describe('一斉配信の開封集計', () => {
  it('LINE集計の到達数を母数として明記する', () => {
    expect(openInsightDetail({
      delivered: 4_012,
      uniqueImpression: 2_410,
      suppressedByAudienceSize: false,
    })).toBe('LINE集計の到達 4,012件のうち 60.1%')
  })

  it('未取得と実値0を分ける', () => {
    expect(openInsightDetail(null)).toBe('—')
    expect(openInsightDetail({ delivered: null, uniqueImpression: 0, suppressedByAudienceSize: false })).toBe('—')
    expect(openInsightDetail({ delivered: 0, uniqueImpression: 0, suppressedByAudienceSize: false }))
      .toBe('LINE集計の到達 0件（割合は算出できません）')
  })

  it('少人数で取得できない理由を維持する', () => {
    expect(openInsightDetail({ delivered: 12, uniqueImpression: null, suppressedByAudienceSize: true }))
      .toBe('配信先が20人未満のため取れません')
  })
})
