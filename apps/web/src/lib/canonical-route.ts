/** ブックマーク互換の入口。権限・アカウント・業種による振分けは含めない。 */
export type LegacyRoutePath = '/conversions' | '/affiliate-offers' | '/settings/features' | '/auto-replies/publish' | '/restaurant-test' | '/restaurant-test/stores' | '/ops'
const affiliateTabs = new Set(['affiliates', 'offers', 'approvals', 'payment', 'points', 'report'])
const fixedTargets = new Map<string, string>([
  ['/affiliate-offers', '/affiliates'],
  ['/settings/features', '/settings'],
  ['/auto-replies/publish', '/auto-replies/edit'],
  ['/restaurant-test', '/hq'],
  ['/restaurant-test/stores', '/hq'],
  ['/ops', '/ops/tenants'],
])

export function legacyRouteDestination(pathname: LegacyRoutePath, search?: string): string
export function legacyRouteDestination(pathname: string, search?: string): string | null
export function legacyRouteDestination(pathname: string, search = ''): string | null {
  const target = pathname === '/conversions' ? '/affiliates' : fixedTargets.get(pathname)
  if (!target) return null
  const params = new URLSearchParams(search)
  if (pathname === '/conversions') {
    const tab = params.get('tab')
    params.set('tab', tab && affiliateTabs.has(tab) ? tab : 'points')
  }
  if (pathname === '/affiliate-offers') params.set('tab', 'offers')
  if (pathname === '/auto-replies/publish') {
    if (!params.get('id')) params.delete('id')
    params.set('step', 'priority')
  }
  const query = params.toString()
  return target + (query ? `?${query}` : '')
}

/** 画面内のリンクだけを直接の行き先へそろえる。外部URLや実在する編集の道は変えない。 */
export function canonicalNavigationHref(href: string): string {
  if (!href.startsWith('/') || href.startsWith('//') || /[\\\u0000-\u0020]/.test(href)) return href
  const url = new URL(href, 'https://navigation.invalid')
  const destination = legacyRouteDestination(url.pathname, url.search)
  return destination ? destination + url.hash : href
}

/** 題・説明書の既定を、転送先と同じ画面から引く。 */
export function canonicalScreenPath(pathname: string): string {
  return legacyRouteDestination(pathname)?.split('?')[0] ?? pathname
}
