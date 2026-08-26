'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * 画面の枠（トップバーと本文の幅）に、ページから値を渡すための口。
 *
 * **なぜ要るか。** ★V6 260枚を数えたところ、画面名はルートから機械的に
 * 決められなかった。約40枚が「Kenta Kawano(Obama)」「夏の定番セット.jpg」
 * 「ももちゃん ／ トリミング」のようにデータの中身そのもので、約100枚が
 * 「タグを作る」「1通目を設定」のようにその画面固有の名前だった。
 * メニュー名で足りるのは約120枚しかない。
 *
 * 詳しくは `docs/v6-shell-contract.md` §3。
 */
export interface PageChrome {
  /** トップバーに出す画面名。null なら既定（menu.ts のラベル）を出す。 */
  title: string | null
  /** true のとき、本文の max-width を外す。受信箱のような全画面レイアウト用。 */
  fullWidth: boolean
}

interface PageChromeStore extends PageChrome {
  setTitle: (title: string | null) => void
  setFullWidth: (full: boolean) => void
}

const PageChromeContext = createContext<PageChromeStore | null>(null)

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null)
  const [fullWidth, setFullWidth] = useState(false)

  const value = useMemo<PageChromeStore>(
    () => ({ title, fullWidth, setTitle, setFullWidth }),
    [title, fullWidth],
  )

  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>
}

/** 枠の側（app-shell）が読む。 */
export function usePageChrome(): PageChrome {
  const store = useContext(PageChromeContext)
  return { title: store?.title ?? null, fullWidth: store?.fullWidth ?? false }
}

/**
 * ページが画面名を渡す。
 *
 * ```tsx
 * usePageTitle(friend?.displayName ?? null)   // 読み込み中は null で既定のまま
 * ```
 *
 * **読み込み中に空文字を渡さない。** 空にするとタイトルだけ消えて画面が跳ねる。
 * まだ分からないときは `null` を渡し、既定を出したままにする。
 */
export function usePageTitle(title: string | null | undefined) {
  const store = useContext(PageChromeContext)
  const setTitle = store?.setTitle
  const next = title && title.length > 0 ? title : null

  useEffect(() => {
    if (!setTitle) return
    setTitle(next)
    // 画面を離れたら既定へ戻す。戻さないと、次の画面に前の名前が残る。
    return () => setTitle(null)
  }, [next, setTitle])
}

/**
 * ページが本文の max-width を外す。受信箱のような3カラム全画面用。
 *
 * **ルート名で自動判定しない。** `/chats` で分岐すると、次に全幅が要る画面が
 * 出るたびに枠を触ることになる。使う側が明示する。
 */
export function useFullWidthPage(enabled = true) {
  const store = useContext(PageChromeContext)
  const setFullWidth = store?.setFullWidth
  const set = useCallback((v: boolean) => setFullWidth?.(v), [setFullWidth])

  useEffect(() => {
    set(enabled)
    return () => set(false)
  }, [enabled, set])
}
