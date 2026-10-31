'use client'

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { formatDocumentTitle } from '@/lib/document-title'
import { defaultTitleForPath, documentTitleForPath } from '@/lib/page-title'

type TitleEntry = { token: symbol; scope: string; name: string }
type TitleStore = { scope: string; register: (scope: string, name: string) => () => void }
const TitleContext = createContext<TitleStore | null>(null)

/** 文書の題を描く持ち主。URL が替わったら前の画面の登録は使わない。同じ道では最後の登録を優先する。 */
export function DocumentTitleProvider({ pathname, children }: { pathname: string; children: ReactNode }) {
  const [entries, setEntries] = useState<TitleEntry[]>([])
  const register = useCallback((scope: string, name: string) => {
    const token = Symbol()
    setEntries(previous => [...previous, { token, scope, name }])
    return () => setEntries(previous => previous.filter(entry => entry.token !== token))
  }, [])
  const value = useMemo(() => ({ scope: pathname, register }), [pathname, register])
  const name = entries.filter(entry => entry.scope === pathname).at(-1)?.name
    ?? documentTitleForPath(pathname, defaultTitleForPath(pathname))
  return <TitleContext.Provider value={value}><title>{formatDocumentTitle(name)}</title>{children}</TitleContext.Provider>
}

/** RootLayout の1か所だけで現在の道をつなぐ。検索条件の変更では持ち主を替えない。 */
export default function DocumentTitleRoot({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/'
  return <DocumentTitleProvider pathname={pathname}>{children}</DocumentTitleProvider>
}

/** 共通部品を単独で描く場合にも、題の持ち主を二重にしない。 */
export function DocumentTitleBoundary({ children }: { children: ReactNode }) {
  const parent = useContext(TitleContext)
  return parent ? children : <DocumentTitleProvider pathname="">{children}</DocumentTitleProvider>
}

export function useDocumentTitleScope() { return useContext(TitleContext)?.scope ?? '' }

/** 認証・スマホ画面も同じ持ち主へ画面名を渡す。埋め込みの無効化時は登録も解除もしない。 */
export function useDocumentTitle(name: string | null | undefined, enabled = true) {
  const store = useContext(TitleContext)
  const register = store?.register
  const scope = store?.scope ?? ''
  const next = name?.trim() || null
  useLayoutEffect(() => {
    if (!register || !next || !enabled) return
    return register(scope, next)
  }, [register, scope, next, enabled])
}
