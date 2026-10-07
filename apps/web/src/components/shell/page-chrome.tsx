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
 * 詳しくは `docs/v8-design-rules.md` §5。
 */
/**
 * 上の帯のパンくずの手前の段（★V8）。
 *
 * `ホーム › 一斉配信`・`一斉配信 › 新商品発売のお知らせ` のように、
 * 画面名の前に「どこから来たか」を1段だけ置く。先頭の「ホーム」は
 * 帯が自分で出すので渡さない。渡さない画面はアカウント名を出さず
 * 題だけにする（絵の指示）。v7 では描かない。
 */
export interface PageCrumb {
  label: string
  href?: string
}

export interface PageChrome {
  /** トップバーに出す画面名。null なら既定（menu.ts のラベル）を出す。 */
  title: string | null
  /** true のとき、本文の max-width を外す。受信箱のような全画面レイアウト用。 */
  fullWidth: boolean
  /** ★V8 パンくずの手前の段。null なら題だけ（アカウント名は出さない）。 */
  crumbs: PageCrumb[] | null
  /** ★V8：画面が「設定の中のメニュー」を白い板の中に置いているとき true（枠の側は外に出さない）。 */
  settingsNavInline: boolean
}

interface PageChromeStore extends PageChrome {
  setTitle: (title: string | null) => void
  setFullWidth: (full: boolean) => void
  setCrumbs: (crumbs: PageCrumb[] | null) => void
  setSettingsNavInline: (inline: boolean) => void
}

const PageChromeContext = createContext<PageChromeStore | null>(null)

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null)
  const [fullWidth, setFullWidth] = useState(false)
  const [crumbs, setCrumbs] = useState<PageCrumb[] | null>(null)
  const [settingsNavInline, setSettingsNavInline] = useState(false)

  const value = useMemo<PageChromeStore>(
    () => ({ title, fullWidth, crumbs, settingsNavInline, setTitle, setFullWidth, setCrumbs, setSettingsNavInline }),
    [title, fullWidth, crumbs, settingsNavInline],
  )

  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>
}

/** 枠の側（app-shell）が読む。 */
export function usePageChrome(): PageChrome {
  const store = useContext(PageChromeContext)
  return { title: store?.title ?? null, fullWidth: store?.fullWidth ?? false, crumbs: store?.crumbs ?? null, settingsNavInline: store?.settingsNavInline ?? false }
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
    /*
     * ブラウザのタブ題が空のままにならないようにする。/hq/support で
     * <title> が無いと監査で落ちた。既にある題は変えない（BrandTitle の
     * 公式アカウント名を上書きしない）。空のときだけ画面名を入れる。
     */
    if (next && typeof document !== 'undefined' && document.title.trim() === '') {
      document.title = next
    }
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

/**
 * ページがパンくずの手前の段を渡す（★V8）。
 *
 * ```tsx
 * usePageCrumbs([{ label: '一斉配信', href: '/broadcasts' }])
 * ```
 *
 * 一覧からの詳細画面で「一斉配信 › 配信名」と出すためのもの。
 * v7 では描かれないので、渡しても v7 の見た目は変わらない。
 * 画面を離れたら既定（アカウント名）へ戻す。
 */
export function usePageCrumbs(crumbs: PageCrumb[] | null) {
  const store = useContext(PageChromeContext)
  const setCrumbs = store?.setCrumbs
  // 呼び出し側は描き出すたびに新しい配列を作る。中身が同じなら
  // 設定し直さないよう、中身で比べる（setCrumbs のたびの再描画を防ぐ）。
  const serialized = JSON.stringify(crumbs)

  useEffect(() => {
    if (!setCrumbs) return
    setCrumbs(crumbs)
    return () => setCrumbs(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, setCrumbs])
}

/**
 * ★V8：画面が「設定の中のメニュー」を白い板の中（題の下の左）に置くと、枠に知らせる。
 * 枠（app-shell）はそのあいだ外のメニューを出さない。まだ移っていない画面は今までどおり外に出る。
 * `SettingsInnerNav inline` がこれを呼ぶので、画面側は部品を置くだけでよい。
 */
export function useSettingsNavInline(enabled = true) {
  const store = useContext(PageChromeContext)
  const setInline = store?.setSettingsNavInline
  useEffect(() => {
    // 外に置くメニュー（enabled=false）は印に触らない。外のメニューが出る・消えるたびに
    // 印を false に戻すと、板の中のメニューと外のメニューが2つ並ぶ（2026-10-07 設定の作業で見つかった）。
    if (!setInline || !enabled) return
    setInline(true)
    return () => setInline(false)
  }, [enabled, setInline])
}
