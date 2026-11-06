import { describe, expect, it } from 'vitest'
import { restaurantDefaultFeatures } from '@line-crm/shared'
import { MENU_SECTIONS, restaurantMenuSections } from './menu'
import { visibleFeatureGroups } from './feature-settings'

describe('飲食店の初期サイドバー', () => {
  it('メインと区分の順序を確定した構成にし、個別項目を設定から切り替えられる', () => {
    const sections = restaurantMenuSections(MENU_SECTIONS)
    expect(sections.map((section) => section.label)).toEqual([
      'メイン', '予約・来店', '店舗運営', '配信', 'コンテンツ', '成果と分析', '自動化', '専用機能', '設定',
    ])
    expect(sections[0].items.map((item) => item.label)).toEqual([
      'ダッシュボード', '受信箱', '友だち', 'タグ', '予約台帳', '来店スタンプ',
    ])
    const groups = visibleFeatureGroups({ specializedFeatureKeys: [], includeRestaurantTest: true, restaurantStyle: true })
    const main = groups.find((group) => group.id === 'basic')!
    expect(main.items.every((item) => item.required)).toBe(true)
    const booking = groups.find((group) => group.id === 'restaurant-booking')!
    expect(booking.items.find((item) => item.id === 'restaurant-tables')?.required).toBeFalsy()
    expect(booking.items.find((item) => item.id === 'restaurant-tables')?.keys).toEqual(['restaurant_menu_restaurant-tables'])
  })

  it('後から使う機能だけを初期オフにする', () => {
    const features = restaurantDefaultFeatures()
    for (const id of ['mileage', 'inflow_tracking', 'analytics', 'automations', 'external_integrations', 'webinars', 'events']) {
      expect(features[id as keyof typeof features]).toBe(false)
    }
    for (const id of ['scenarios', 'broadcasts', 'booking', 'restaurant_test', 'visit_stamps']) {
      expect(features[id as keyof typeof features]).toBe(true)
    }
  })
})
