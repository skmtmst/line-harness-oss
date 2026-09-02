/**
 * 店舗を選ばなくても扱える画面の正本。
 *
 * ここに無い画面はすべて店舗単位として扱う。新しい画面を追加したときに
 * 判定漏れでデータが見えることがないよう、fail closed にしている。
 */
export const ACCOUNT_INDEPENDENT_ROUTE_PREFIXES = [
  '/hq',
  '/login',
  '/staff',
  '/settings',
  '/emergency',
  '/health',
  '/accounts',
  '/restaurant-test/stores',
  '/restaurant-test/terms',
] as const

export function isAccountIndependentRoute(pathname: string): boolean {
  return ACCOUNT_INDEPENDENT_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export type StoreRouteDecision = 'show' | 'wait' | 'block-unselected'

export function decideStoreRoute(
  pathname: string,
  loading: boolean,
  selectedAccountId: string | null,
): StoreRouteDecision {
  if (isAccountIndependentRoute(pathname)) return 'show'
  if (loading) return 'wait'
  if (!selectedAccountId) return 'block-unselected'
  return 'show'
}
