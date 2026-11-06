import type { MouseEvent } from 'react'
export { usePreparingDialog } from '@/components/shared/preparing-dialog'
import { environmentFeatureUiEnabled, googleBusinessUiEnabled, restaurantTestUiEnabled } from '@/lib/environment-features'

/**
 * 環境の旗による左メニューの出し入れ。
 * Google ビジネスは独立の旗で出し入れする。飲食店の試験の機能は旗が閉じていても入口を残す（押すと準備中）。
 * 判定しない項目は undefined を返し、呼び手のふだんの判定に任せる。
 */
export function featureGateVisibility(item: { href: string; featureKey?: string }): boolean | undefined {
  if (item.href === '/restaurant-test/google') return googleBusinessUiEnabled()
  if (item.featureKey === 'restaurant_test' && !restaurantTestUiEnabled()) return true
  return undefined
}

/** 旗が閉じている入口を押した時は移動を止め、準備中の窓を出す。移動してよければ true。 */
export function allowFeatureNavigation(event: MouseEvent, href: string, label: string, preparing: { open: (label: string) => void }): boolean {
  if (environmentFeatureUiEnabled(href)) return true
  event.preventDefault()
  preparing.open(label)
  return false
}
