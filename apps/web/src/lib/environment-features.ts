/**
 * 静的書き出しされる管理画面の環境限定機能。
 * 値が無い本番ビルドを安全側へ倒すため、明示的な true だけを有効にする。
 */
export function googleBusinessUiEnabled(
  value = process.env.NEXT_PUBLIC_GOOGLE_BUSINESS_ENABLED,
): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function restaurantTestUiEnabled(
  value = process.env.NEXT_PUBLIC_RESTAURANT_TEST_ENABLED,
): boolean {
  return value?.trim().toLowerCase() === 'true'
}

/** Google だけを飲食店の試験スイッチから分ける。似た名前のパスは含めない。 */
export function environmentFeatureForPath(path: string): 'google-business' | 'restaurant-test' | null {
  if (path === '/restaurant-test/google' || path.startsWith('/restaurant-test/google/')) return 'google-business'
  if (path === '/restaurant-test' || path.startsWith('/restaurant-test/') || path === '/settings/booking-media' || path === '/settings/delivery') return 'restaurant-test'
  return null
}

export function environmentFeatureUiEnabled(path: string): boolean {
  const feature = environmentFeatureForPath(path)
  return feature === 'google-business' ? googleBusinessUiEnabled() : feature === 'restaurant-test' ? restaurantTestUiEnabled() : true
}
