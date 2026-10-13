'use client'

import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { createContext, useContext, useMemo, type ComponentProps } from 'react'
import { currentListLocation, flushListUrlState, notifyListLocation, useListLocation, useOnAccountSwitch } from './list-url-state'

/** 戻り先にしてよい一覧。最長のパスから照合し、別機能へ条件を渡さない。 */
export const LIST_PATHS = [
  '/tags', '/templates', '/form-submissions', '/friends', '/broadcasts', '/scenarios',
  '/auto-replies', '/reminders', '/rich-menus', '/events', '/webinars', '/automations',
  '/common-actions', '/contents/vars', '/contents', '/conversions', '/inflow-links',
  '/friend-add-settings', '/accounts', '/staff', '/pools', '/webhooks', '/scoring',
  '/mileage', '/affiliate-offers', '/affiliates', '/nen-campaigns', '/nen/pets',
  '/booking/menus', '/booking/staff', '/booking/bookings', '/line-notifications',
  '/hq/friend-attributes', '/hq/templates', '/hq/form-submissions', '/hq/rich-menus', '/hq/broadcasts', '/hq/banners',
  '/ops/tenants', '/restaurant-test/reservations', '/restaurant-test/menu',
] as const
const paths = [...LIST_PATHS].sort((a, b) => b.length - a.length)
const familyOf = (path: string) => paths.find(list => path === list || path.startsWith(`${list}/`))
const relative = (url: URL) => `${url.pathname}${url.search}${url.hash}`
const clean = (url: URL) => {
  url.searchParams.delete('returnTo')
  url.searchParams.delete('returnAccount')
  return url
}

export const ListNavigationAccount = createContext<string | null>(null)
export const RowNavigation = createContext<{ key: string; id: string } | null>(null)

/** アカウントを替えたら元の一覧条件を捨て、再び戻しても復活させない。 */
export function ListReturnAccountGuard({ accountId }: { accountId: string | null }) {
  useOnAccountSwitch(accountId, () => {
    if (typeof window === 'undefined' || !window.location?.href) return
    flushListUrlState()
    const url = new URL(window.location.href)
    clean(url)
    window.history.replaceState(window.history.state, '', relative(url))
    notifyListLocation()
  })
  return null
}

/** 同じサイト・同じ一覧のURLだけを許す。別アカウント・直接開いた時は一覧へ。 */
export function listReturnUrl(current: string, fallback: string, account: string | null, origin: string): string {
  try {
    const page = new URL(current, origin)
    const raw = page.searchParams.get('returnTo')
    if (!raw || page.searchParams.get('returnAccount') !== (account ?? '')) return fallback
    // バックスラッシュや制御文字をURLとして読み替えない。
    if (/[\\\u0000-\u0020]/.test(raw)) return fallback
    const url = new URL(raw, origin)
    if (url.origin !== origin || url.username || url.password || url.pathname !== fallback || !paths.includes(url.pathname as typeof paths[number])) return fallback
    return relative(clean(url))
  } catch { return fallback }
}

/** 名前・メニュー・詳細→編集・キャンセル・パンくずが同じ戻り先を持つ。 */
export function listNavigationHref(href: string, current: string, account: string | null, origin: string, row?: { key: string; id: string } | null): string {
  try {
    const from = new URL(current, origin)
    const to = new URL(href, origin)
    const family = familyOf(from.pathname)
    if (!family || from.origin !== origin || to.origin !== origin || familyOf(to.pathname) !== family || href.startsWith('#')) return href
    const fromList = from.pathname === family && !(family.startsWith('/hq/') && from.searchParams.has('item'))
    const toList = to.pathname === family && !(family.startsWith('/hq/') && to.searchParams.has('item'))
    if (toList) {
      return !fromList && (from.searchParams.has('returnTo') || !to.search && !to.hash) ? listReturnUrl(current, family, account, origin) : href
    }
    let back: string
    if (fromList) {
      const source = clean(new URL(from))
      if (row) source.searchParams.set(row.key, row.id)
      back = relative(source)
    } else {
      back = listReturnUrl(current, family, account, origin)
    }
    if (back === family && !row && (fromList || !from.searchParams.has('returnTo'))) return href
    clean(to)
    to.searchParams.set('returnTo', back)
    to.searchParams.set('returnAccount', account ?? '')
    return relative(to)
  } catch { return href }
}

export function useListNavigationHref() {
  const account = useContext(ListNavigationAccount)
  const row = useContext(RowNavigation)
  const location = useListLocation()
  return (href: string) => location ? listNavigationHref(href, location, account, window.location.origin, row) : href
}

export function useListReturnHref(fallback: string): string {
  return useListNavigationHref()(fallback)
}

/** 同じ一覧のURLで表示する既存の詳細も、名前のLinkから別タブで開ける。 */
export function useListItemHref() {
  const location = useListLocation()
  return (key: string, id: string, extra: Record<string, string> = {}) => {
    const url = new URL(location || '/', 'http://localhost')
    url.searchParams.set(key, id)
    for (const [name, value] of Object.entries(extra)) url.searchParams.set(name, value)
    return relative(url)
  }
}

/** Next Link の動き（新しいタブ・離脱確認）をそのまま使う。 */
export default function PageLink({ href, ...props }: ComponentProps<typeof NextLink>) {
  const destination = useListNavigationHref()
  return <NextLink {...props} href={typeof href === 'string' ? destination(href) : href} />
}

/** ボタン経由の移動も、Link と同じ口で戻り先を持ち運ぶ。 */
export function useListNavigationRouter(): ReturnType<typeof useRouter> {
  const router = useRouter()
  const account = useContext(ListNavigationAccount)
  return useMemo(() => {
    const destination = (href: string) => {
      if (typeof window === 'undefined' || !window.location) return href
      flushListUrlState()
      const loc = currentListLocation()
      return listNavigationHref(href, `${loc.pathname}${loc.search}${loc.hash}`, account, window.location.origin)
    }
    return { ...router, push: (href, ...options) => router.push(destination(href), ...options), replace: (href, ...options) => router.replace(destination(href), ...options) }
  }, [account, router])
}
