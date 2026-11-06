'use client'

/*
 * 自前の窓分け（バーチャル・スクロール）。2026-10-07 速さの作業。
 *
 * 受信箱の会話の一覧と吹き出しは、件数が数千になると DOM が数万要素になり、
 * 入力1文字ごとの描き直しとスクロールが重くなる。見えている所の前後だけを
 * 描き、上下は高さだけの空き箱で埋める。
 *
 * - 行の高さはばらばら（吹き出し・2行の要約）。描いた行を測って覚え、
 *   まだ測っていない行は見込みの高さで置く。
 * - **見ている位置を守る。** 上に足した（前のメッセージ）・測り直して高さが
 *   変わった・画像が後から読めた、のどれでも、画面の中の同じ行が同じ場所に
 *   残るよう scrollTop を直す（いちばん上に見えている行を目印にする）。
 * - 下に付ける形（stickToBottom）：いちばん下にいる間は、新着・高さの変化の
 *   たびに下へ寄せ直す。読み返している途中なら動かさない。
 * - 寸法の取れない環境（試験の jsdom など、見える高さが 0）は全部描く。
 *
 * 依存を足さない（@tanstack/react-virtual は入っていない）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'

export type VirtualWindowOptions = {
  count: number
  getKey: (index: number) => string
  /** まだ測っていない行の見込みの高さ（px） */
  estimate: number
  /** 見えている所の上下に余分に描く量（px） */
  overscan?: number
  scrollerRef: RefObject<HTMLElement | null>
  contentRef: RefObject<HTMLElement | null>
  /** 下に付ける（会話の吹き出し）。いちばん下にいる間は下へ寄せ続ける */
  stickToBottom?: boolean
  /** いちばん上の近く（px）まで来たら呼ぶ（古い分を読む） */
  onReachStart?: () => void
  reachStartPx?: number
}

export type VirtualWindow = {
  start: number
  end: number
  padTop: number
  padBottom: number
  /** 窓分けしているか（false のときは全部描いている） */
  virtual: boolean
  /** その行が見える所までスクロールする。描かれるのは次の描画のあと */
  scrollToIndex: (index: number, align?: 'start' | 'end' | 'nearest') => void
}

const ITEM_ATTR = 'data-vw-key'
const BOTTOM_SLACK = 40

export function useVirtualWindow(options: VirtualWindowOptions): VirtualWindow {
  const { count, getKey, estimate, overscan = 800, scrollerRef, contentRef, stickToBottom = false, onReachStart, reachStartPx = 600 } = options
  const heights = useRef(new Map<string, number>())
  const [version, setVersion] = useState(0)
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  const stickRef = useRef(stickToBottom)
  const anchorRef = useRef<{ key: string; offset: number } | null>(null)
  /*
   * 最後に見た scrollTop。スクロールの知らせは次のコマで来るので、その前に
   * 描き直しが走ると「まだ下にいる」と思って下へ戻してしまう（キーボード・
   * 「新着」ボタン・プログラムで位置を変えた直後）。違っていたら先に取り込む。
   */
  const lastTopRef = useRef(0)
  const reachStartRef = useRef(onReachStart)
  reachStartRef.current = onReachStart

  /*
   * スクロールする欄。欄と中身が同じ描画で生まれると、子の効果が走る時点では
   * 親の ref がまだ付いていない（React は子の効果を先に走らせる）。そのときは
   * 中身の親をたどって見つけ、見つかった欄に付け直す。
   */
  const getScroller = useCallback((): HTMLElement | null => {
    if (scrollerRef.current) return scrollerRef.current
    let el = contentRef.current?.parentElement ?? null
    while (el) {
      const overflow = getComputedStyle(el).overflowY
      if (overflow === 'auto' || overflow === 'scroll') return el
      el = el.parentElement
    }
    return null
  }, [scrollerRef, contentRef])
  const [scrollerEl, setScrollerEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const el = getScroller()
    if (el !== scrollerEl) setScrollerEl(el)
  })

  /* 行の上端（中身の箱の中での位置）。数千行でも 1ms 未満。 */
  const offsets = useMemo(() => {
    const out = new Float64Array(count + 1)
    for (let i = 0; i < count; i += 1) out[i + 1] = out[i] + (heights.current.get(getKey(i)) ?? estimate)
    return out
    // version: 測り直しで高さが変わったら作り直す
  }, [count, getKey, estimate, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const total = offsets[count]

  const contentTop = useCallback(() => {
    const scroller = getScroller()
    const content = contentRef.current
    if (!scroller || !content) return 0
    return content.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
  }, [getScroller, contentRef])

  const indexOfKey = useMemo(() => {
    const map = new Map<string, number>()
    for (let i = 0; i < count; i += 1) map.set(getKey(i), i)
    return map
  }, [count, getKey])

  /*
   * いちばん上に見えている行を目印として覚える。大きく飛んだ直後は、描いて
   * いる行がまだ前の場所のもの（画面の外）なので、そのときは覚えた高さから
   * 画面の上端にある行を出して目印にする（画面の外の行を目印にすると、
   * 間の行を測り直したぶんだけ見ている所がずれる）。
   */
  const recordAnchor = useCallback(() => {
    const scroller = getScroller()
    const content = contentRef.current
    if (!scroller || !content) return
    const box = scroller.getBoundingClientRect()
    const items = content.querySelectorAll<HTMLElement>(`[${ITEM_ATTR}]`)
    for (const item of items) {
      const rect = item.getBoundingClientRect()
      if (rect.bottom > box.top && rect.top < box.bottom) {
        anchorRef.current = { key: item.getAttribute(ITEM_ATTR) ?? '', offset: rect.top - box.top }
        return
      }
    }
    if (count === 0) { anchorRef.current = null; return }
    const viewTop = scroller.scrollTop - contentTop()
    let a = 0; let b = count - 1
    while (a < b) { const m = (a + b) >> 1; if (offsets[m + 1] <= viewTop) a = m + 1; else b = m }
    anchorRef.current = { key: getKey(a), offset: offsets[a] - viewTop }
  }, [getScroller, contentRef, count, offsets, contentTop, getKey])

  const syncFromScroll = useCallback(() => {
    const scroller = getScroller()
    if (!scroller) return
    lastTopRef.current = scroller.scrollTop
    stickRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= BOTTOM_SLACK
    recordAnchor()
  }, [getScroller, recordAnchor])

  /*
   * 目印の行を同じ場所へ戻す。下に付いている間は下へ寄せる。
   * 目印が描かれていない（上に足した直後など）ときは、覚えた高さから位置を出す。
   */
  const restore = useCallback(() => {
    const scroller = getScroller()
    const content = contentRef.current
    if (!scroller || !content) return
    if (Math.abs(scroller.scrollTop - lastTopRef.current) > 1) syncFromScroll()
    if (stickToBottom && stickRef.current) {
      const target = scroller.scrollHeight - scroller.clientHeight
      if (Math.abs(scroller.scrollTop - target) > 1) scroller.scrollTop = target
      lastTopRef.current = scroller.scrollTop
      return
    }
    const anchor = anchorRef.current
    if (!anchor) return
    const scrollerTop = scroller.getBoundingClientRect().top
    const el = content.querySelector<HTMLElement>(`[${ITEM_ATTR}="${CSS.escape(anchor.key)}"]`)
    let delta = 0
    if (el) {
      delta = el.getBoundingClientRect().top - scrollerTop - anchor.offset
    } else {
      const index = indexOfKey.get(anchor.key)
      if (index === undefined) return
      delta = contentTop() + offsets[index] - scroller.scrollTop - anchor.offset
    }
    if (Math.abs(delta) >= 1) {
      scroller.scrollTop += delta
      lastTopRef.current = scroller.scrollTop
      // 直した位置で下にいるかを取り直す（スクロールの知らせは後から来る）。
      stickRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= BOTTOM_SLACK
    }
  }, [getScroller, contentRef, stickToBottom, indexOfKey, offsets, contentTop, syncFromScroll])

  const readViewport = useCallback(() => {
    const scroller = getScroller()
    if (!scroller) return
    const top = scroller.scrollTop - contentTop()
    const height = scroller.clientHeight
    setViewport((prev) => (Math.abs(prev.top - top) < 1 && prev.height === height ? prev : { top, height }))
  }, [getScroller, contentTop])

  // 見張りは付けたままにし、呼ぶ先はいつも最新の描画のものにする（高さが変わるたびに付け直さない）。
  const scrollFnsRef = useRef({ syncFromScroll, readViewport, contentTop })
  scrollFnsRef.current = { syncFromScroll, readViewport, contentTop }

  /* スクロールを追う。描き直しはコマごとに1回まで。 */
  useLayoutEffect(() => {
    const scroller = scrollerEl
    if (!scroller) return
    let frame = 0
    const onScroll = () => {
      // 自分で直した位置への移動（目印へ戻した・下へ寄せた）の知らせは取り込まない。
      // その時点の描画はまだ古い窓のことがあり、違う行を目印にしてしまう。
      const fns = scrollFnsRef.current
      if (Math.abs(scroller.scrollTop - lastTopRef.current) > 1) fns.syncFromScroll()
      if (reachStartRef.current && scroller.scrollTop - fns.contentTop() < reachStartPx) reachStartRef.current()
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; scrollFnsRef.current.readViewport() })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scrollFnsRef.current.readViewport()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => scrollFnsRef.current.readViewport())
    ro?.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      ro?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [scrollerEl, reachStartPx])

  const virtual = viewport.height > 0 && count > 0

  /* 見える範囲（上下に overscan）。下に付いている間は下端から数える。 */
  let start = 0
  let end = count
  if (virtual) {
    const viewTop = stickToBottom && stickRef.current ? Math.max(0, total - viewport.height) : viewport.top
    const lo = viewTop - overscan
    const hi = viewTop + viewport.height + overscan
    let a = 0; let b = count
    while (a < b) { const m = (a + b) >> 1; if (offsets[m + 1] <= lo) a = m + 1; else b = m }
    start = Math.min(a, count)
    a = start; b = count
    while (a < b) { const m = (a + b) >> 1; if (offsets[m] < hi) a = m + 1; else b = m }
    end = Math.max(start + 1, Math.min(a, count))
  }
  const padTop = virtual ? offsets[start] : 0
  const padBottom = virtual ? total - offsets[end] : 0

  /* 描いた行を測る。高さが変わった行があれば作り直し、目印の位置へ戻す。 */
  const roRef = useRef<ResizeObserver | null>(null)
  const measure = useCallback(() => {
    const content = contentRef.current
    if (!content) return false
    let changed = false
    for (const item of content.querySelectorAll<HTMLElement>(`[${ITEM_ATTR}]`)) {
      const key = item.getAttribute(ITEM_ATTR) ?? ''
      const h = item.offsetHeight
      if (h > 0 && heights.current.get(key) !== h) {
        heights.current.set(key, h)
        changed = true
      }
    }
    return changed
  }, [contentRef])

  // 見張りは1つだけ作るので、呼ぶ先はいつも最新の描画のものにする（古い高さで直さない）。
  const latestRef = useRef({ measure, restore, readViewport })
  latestRef.current = { measure, restore, readViewport }

  useLayoutEffect(() => {
    const changed = measure()
    restore()
    readViewport()
    if (changed) setVersion((v) => v + 1)
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    // 画像の読み込みなどで行の高さが後から変わったとき。
    if (!roRef.current) {
      roRef.current = new ResizeObserver(() => {
        const latest = latestRef.current
        const moved = latest.measure()
        latest.restore()
        latest.readViewport()
        if (moved) setVersion((v) => v + 1)
      })
    }
    const ro = roRef.current
    ro.disconnect()
    for (const item of content.querySelectorAll<HTMLElement>(`[${ITEM_ATTR}]`)) ro.observe(item)
  })
  useEffect(() => () => roRef.current?.disconnect(), [])

  const scrollToIndex = useCallback((index: number, align: 'start' | 'end' | 'nearest' = 'nearest') => {
    const scroller = getScroller()
    if (!scroller || index < 0 || index >= count) return
    const base = contentTop()
    const top = base + offsets[index]
    const bottom = base + offsets[index + 1]
    const viewTop = scroller.scrollTop
    const viewBottom = viewTop + scroller.clientHeight
    let next = viewTop
    if (align === 'start' || (align === 'nearest' && top < viewTop)) next = top
    else if (align === 'end' || (align === 'nearest' && bottom > viewBottom)) next = bottom - scroller.clientHeight
    if (next !== viewTop) scroller.scrollTop = next
  }, [getScroller, count, offsets, contentTop])

  return { start, end, padTop, padBottom, virtual, scrollToIndex }
}

export const VIRTUAL_ITEM_ATTR = ITEM_ATTR
