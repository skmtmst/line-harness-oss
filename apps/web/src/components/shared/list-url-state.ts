'use client'

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from 'react'

/*
 * 一覧の絞り込み・検索語・並び順・ページを URL に置く口（動きの点検 5 番）。
 *
 * 以前は各一覧が useState だけで持っていたので、詳細へ行って「戻る」と
 * フォルダの絞り込みも検索語も消えていた。URL に置けば、戻る・再読み込み・
 * リンクの共有でも同じ一覧に戻れる。
 *
 * 使い方（画面側は useState をこれに替えるだけ）：
 *   const [view, setView] = useListUrlState({ folder: '', q: '', page: '1' })
 *   setView({ folder: 'abc', page: '1' })
 *
 * - 値は文字列だけ。既定値と同じ値は URL から消す（何もしていない一覧は ?なし）。
 * - URL は置き換え（replaceState）で直す。絞るたびに「戻る」の段が増えない。
 * - 知らない鍵（?id= など）は残す。
 * - 静的書き出しの最初の描画（サーバー側）は既定値。読み込んだ直後に URL の値へ替わる。
 *   useSearchParams を使わないので、画面を Suspense で包む必要はない。
 */

const LOCAL_EVENT = 'lh:list-url-state'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(LOCAL_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(LOCAL_EVENT, onChange)
  }
}

const readSearch = () => window.location.search
const readServerSearch = () => ''

export function parseListUrlState<T extends Record<string, string>>(search: string, defaults: T): T {
  const params = new URLSearchParams(search)
  const out = { ...defaults }
  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    const value = params.get(key)
    if (value !== null) out[key] = value as T[typeof key]
  }
  return out
}

/** 今の URL に patch を重ねた次の URL（既定値と同じ鍵は消す）。 */
export function nextListUrl<T extends Record<string, string>>(
  location: { pathname: string; search: string; hash: string },
  defaults: T,
  patch: Partial<T>,
): string {
  const params = new URLSearchParams(location.search)
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (value === '' || value === defaults[key]) params.delete(key)
    else params.set(key, value)
  }
  const query = params.toString()
  return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`
}

export function useListUrlState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const search = useSyncExternalStore(subscribe, readSearch, readServerSearch)
  // 呼ぶ側が毎回 {…} を書いても同じ値として扱う。
  const defaultsKey = JSON.stringify(defaults)
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const state = useMemo(() => parseListUrlState(search, defaultsRef.current), [search, defaultsKey])
  const set = useCallback((patch: Partial<T>) => {
    const url = nextListUrl(window.location, defaultsRef.current, patch)
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (url === current) return
    // Next.js（14.1 以降）は history.replaceState を受け取って router と同期する。
    window.history.replaceState(null, '', url)
    window.dispatchEvent(new Event(LOCAL_EVENT))
  }, [])
  return [state, set]
}

/**
 * 1 つの鍵だけを URL に置く（useState('') の置き換え）。
 * 既存の画面は `const [q, setQ] = useState('')` を
 * `const [q, setQ] = useListUrlParam('q')` に替えるだけでよい。
 */
export function useListUrlParam(key: string, fallback = ''): [string, (next: string) => void] {
  const search = useSyncExternalStore(subscribe, readSearch, readServerSearch)
  const value = useMemo(() => new URLSearchParams(search).get(key) ?? fallback, [fallback, key, search])
  const set = useCallback((next: string) => writeListUrlParam(key, next === fallback ? '' : next), [fallback, key])
  return [value, set]
}

/** 入/切の絞り込み（「停止中だけ」など）。入のときだけ `?鍵=1` を置く。 */
export function useListUrlFlag(key: string): [boolean, (next: boolean) => void] {
  const [raw, setRaw] = useListUrlParam(key)
  const set = useCallback((next: boolean) => setRaw(next ? '1' : ''), [setRaw])
  return [raw === '1', set]
}

/** 1 つの鍵をその場で URL に書く（空なら消す）。フックの外（ページ送りなど）から使う。 */
export function writeListUrlParam(key: string, value: string): void {
  if (typeof window === 'undefined') return
  const url = nextListUrl(window.location, { [key]: '' }, { [key]: value })
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (url === current) return
  window.history.replaceState(null, '', url)
  window.dispatchEvent(new Event(LOCAL_EVENT))
}

/**
 * 今の URL の値をその場で読む（描画に出さない初期値用：検索の送り遅れの元など）。
 * サーバー側では既定値。
 */
export function readListUrlParam(key: string, fallback = ''): string {
  if (typeof window === 'undefined') return fallback
  return new URLSearchParams(window.location.search).get(key) ?? fallback
}

/* ── スクロール位置を戻す ─────────────────────────────── */

let lastPopstateAt = -Infinity
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    lastPopstateAt = performance.now()
  })
}

/** 戻る・進む・再読み込みで来たときだけ位置を戻す（左メニューから来たら先頭）。 */
function cameBackOrReloaded(): boolean {
  if (performance.now() - lastPopstateAt < 3000) return true
  const entry = performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined
  return entry?.type === 'reload' || entry?.type === 'back_forward'
}

function scrollerOf(start: HTMLElement | null): HTMLElement {
  let element = start?.parentElement ?? null
  while (element) {
    const style = getComputedStyle(element)
    if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) return element
    element = element.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

const scrollKey = (path: string) => `lh:list-scroll:${path}`

/**
 * 一覧のスクロール位置を、そのタブの間だけ覚えて戻す。
 * `ready` は中身が描けたか（読み込み中は戻さない。高さが足りず先頭に張り付く）。
 * `anchorRef` は一覧の中の要素。そこから実際に動く入れ物を探す。
 */
export function useListScrollMemory(ready: boolean, anchorRef?: RefObject<HTMLElement | null>): void {
  const restoredRef = useRef(false)
  const restoringRef = useRef(false)
  const shouldRestoreRef = useRef<boolean | null>(null)
  /* 覚えていた位置は来た瞬間に読む。読み込み中に途中の位置で上書きされる前に。 */
  const savedRef = useRef(0)
  if (shouldRestoreRef.current === null && typeof window !== 'undefined') {
    shouldRestoreRef.current = cameBackOrReloaded()
    try {
      savedRef.current = Number(window.sessionStorage.getItem(scrollKey(window.location.pathname))) || 0
    } catch {
      savedRef.current = 0
    }
  }

  useEffect(() => {
    if (!ready || restoredRef.current) return
    restoredRef.current = true
    if (!shouldRestoreRef.current) return
    const saved = savedRef.current
    if (saved <= 0) return
    /*
     * 数の帯など後から出る部分で高さが伸びきるまで、届くまで数コマ当て直す
     * （最長 1.5 秒）。利用者が自分で動かしたらやめる。
     */
    restoringRef.current = true
    const started = performance.now()
    let frame = 0
    const stop = () => {
      restoringRef.current = false
      cancelAnimationFrame(frame)
      window.removeEventListener('wheel', byUser)
      window.removeEventListener('touchstart', byUser)
      window.removeEventListener('keydown', byUser)
    }
    const apply = () => {
      const scroller = scrollerOf(anchorRef?.current ?? null)
      scroller.scrollTop = saved
      if (Math.abs(scroller.scrollTop - saved) <= 1 || performance.now() - started > 1500) {
        finished = true
        stop()
        return
      }
      frame = requestAnimationFrame(apply)
    }
    const byUser = () => {
      finished = true
      stop()
    }
    let finished = false
    window.addEventListener('wheel', byUser, { passive: true })
    window.addEventListener('touchstart', byUser, { passive: true })
    window.addEventListener('keydown', byUser)
    frame = requestAnimationFrame(apply)
    return () => {
      stop()
      // 途中で外された（開発時の二重実行など）ときは、次の実行でもう一度戻す。
      if (!finished) restoredRef.current = false
    }
  }, [anchorRef, ready])

  useEffect(() => {
    const path = window.location.pathname
    let frame = 0
    const save = () => {
      frame = 0
      // 中身が出て位置を戻し終えるまでは覚えない（伸びきる前の途中の値で上書きしない）。
      if (!restoredRef.current || restoringRef.current) return
      try {
        window.sessionStorage.setItem(scrollKey(path), String(Math.round(scrollerOf(anchorRef?.current ?? null).scrollTop)))
      } catch {
        // 覚えられないだけで一覧は動く。
      }
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(save)
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      if (frame) cancelAnimationFrame(frame)
    }
  }, [anchorRef])
}
