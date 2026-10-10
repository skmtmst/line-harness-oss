'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/** B-158：ほかの絞り込みとハッシュを残し、タブだけを置き換える。入れ子は親/子。 */
export function tabHref(href: string, tab: string, parent?: string): string {
  const url = new URL(href, 'http://localhost')
  url.searchParams.set('tab', parent ? `${parent}/${tab}` : tab)
  return `${url.pathname}${url.search}${url.hash}`
}
export function tabFromUrl<T extends string>(href: string, values: readonly T[], fallback: T, parent?: string): T {
  const raw = new URL(href, 'http://localhost').searchParams.get('tab')
  const value = parent ? raw?.startsWith(`${parent}/`) ? raw.slice(parent.length + 1) : null : raw
  return values.includes(value as T) ? value as T : fallback
}
/** URLの再読込・戻るでも同じタブを描く。段やカードの選択には使わない。 */
export function useUrlTab<T extends string>(values: readonly T[], fallback: T, parent?: string): [T, (next: T) => void] {
  const router = useRouter()
  const [tab, setTab] = useState<T>(fallback)
  const key = values.join('\0')
  useEffect(() => {
    const read = () => setTab(tabFromUrl(window.location.href, key.split('\0') as T[], fallback, parent))
    read()
    window.addEventListener('popstate', read)
    window.addEventListener('musubo-tab-change', read)
    return () => { window.removeEventListener('popstate', read); window.removeEventListener('musubo-tab-change', read) }
  }, [key, fallback, parent])
  const select = useCallback((next: T) => {
    setTab(next)
    const href = tabHref(window.location.href, next, parent)
    window.history.replaceState(window.history.state, '', href)
    window.dispatchEvent(new Event('musubo-tab-change'))
    router.replace(href, { scroll: false })
  }, [router, parent])
  return [tab, select]
}
