import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FEATURES,
  FEATURE_GROUPS,
  SIDEBAR_FEATURE_BY_HREF,
  groupEnabledCount,
  groupFeatureCount,
  itemIsEnabled,
  visibleFeatureGroups,
} from './feature-settings'

describe('V2 10-3 機能設定', () => {
  it('V2どおりウェビナー・成果アフィリエイト・多店舗を初期オフにする', () => {
    expect(DEFAULT_FEATURES.webinars).toBe(false)
    expect(DEFAULT_FEATURES.affiliates).toBe(false)
    expect(DEFAULT_FEATURES.multi_store_hierarchy).toBe(false)
    expect(DEFAULT_FEATURES.nen_campaigns).toBe(true)
    expect(DEFAULT_FEATURES.photo_review).toBe(true)
    expect(DEFAULT_FEATURES.ec_commerce).toBe(true)
  })

  it('基本3機能は常に有効で、配信は7機能として数える', () => {
    const basic = FEATURE_GROUPS.find((group) => group.id === 'basic')!
    const delivery = FEATURE_GROUPS.find((group) => group.id === 'delivery')!
    expect(basic.items.every((item) => item.required && itemIsEnabled(item, {}))).toBe(true)
    expect(groupFeatureCount(delivery)).toBe(7)
    expect(groupEnabledCount(delivery, DEFAULT_FEATURES)).toBe(6)
  })

  it('多店舗管理は複数LINE・親子モード時だけ最下部に表示する', () => {
    const hidden = visibleFeatureGroups({
      showMultiStore: false,
      specializedFeatureKeys: ['nen_campaigns', 'photo_review', 'ec_commerce'],
    })
    expect(hidden.some((group) => group.id === 'multi-store')).toBe(false)

    const shown = visibleFeatureGroups({
      showMultiStore: true,
      specializedFeatureKeys: ['nen_campaigns', 'photo_review', 'ec_commerce'],
    })
    expect(shown.at(-1)?.id).toBe('multi-store')
  })

  it('専門設計カタログにある項目だけを表示する', () => {
    const groups = visibleFeatureGroups({
      showMultiStore: false,
      specializedFeatureKeys: ['photo_review'],
    })
    const specialized = groups.find((group) => group.id === 'specialized')!
    expect(specialized.items.map((item) => item.id)).toEqual(['photo-review'])

    const withoutDesign = visibleFeatureGroups({ showMultiStore: false, specializedFeatureKeys: [] })
    expect(withoutDesign.some((group) => group.id === 'specialized')).toBe(false)
  })

  it('画面のスイッチとサイドメニュー項目が対応している', () => {
    expect(SIDEBAR_FEATURE_BY_HREF['/scenarios']).toBe('scenarios')
    expect(SIDEBAR_FEATURE_BY_HREF['/webinars']).toBe('webinars')
    expect(SIDEBAR_FEATURE_BY_HREF['/nen-members']).toBe('photo_review')
    expect(SIDEBAR_FEATURE_BY_HREF['/ec-commerce']).toBe('ec_commerce')
  })
})
