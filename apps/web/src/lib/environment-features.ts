/**
 * 静的書き出しされる管理画面の環境限定機能。
 * 値が無い本番ビルドを安全側へ倒すため、明示的な true だけを有効にする。
 */
export function restaurantTestUiEnabled(
  value = process.env.NEXT_PUBLIC_RESTAURANT_TEST_ENABLED,
): boolean {
  return value?.trim().toLowerCase() === 'true'
}
