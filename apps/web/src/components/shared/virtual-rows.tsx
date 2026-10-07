'use client'

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAdminTheme } from '@/lib/use-admin-theme'

/*
 * 見えている行だけ描く窓（M10・V8のみ）。
 *
 * 2,000行の一覧が全部描画で遅いため、窓の内側だけDOMに置き、
 * 上下に見えない分の高さの詰め物を入れてスクロール位置を保つ。
 * 行の高さは固定（今のまま変えない）。v7・行数が少ないときは
 * 今までどおり全部描く（聞き口も付けない）。
 *
 * 崩さないもの：
 * - キーボード：描いた行の中身は今までと同一。指が当たっている
 *   行は窓から外さない（外すと指が消えるため）。
 * - 読み上げ：描いた行の印・文は同一。窓自体に role は付けない
 *   （行は link 役割のまま。ページ送りと同じく、画面外は無い扱い）。
 * - 選んだ行：選び自体は外の Set が持つ。描いた選んだ行の印は同一。
 */

export interface VirtualRange {
  start: number
  end: number
}

/** 窓の範囲。見える分＋前後の予備。指が当たっている行は必ず含める。 */
export function virtualRange(
  count: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
  focusedIndex: number | null,
): VirtualRange {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(count, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
  if (focusedIndex === null || (focusedIndex >= start && focusedIndex < end)) {
    return { start, end }
  }
  // 指が当たっている行は外さない。前後に予備を付けて窓を広げる。
  return {
    start: Math.max(0, Math.min(start, focusedIndex - overscan)),
    end: Math.min(count, Math.max(end, focusedIndex + 1 + overscan)),
  }
}

const ESTIMATED_ROWS = 30

export function VirtualRows({
  count,
  rowHeight,
  overscan = 5,
  threshold = 60,
  renderRow,
  className,
  itemClassName,
}: {
  /** 行数。 */
  count: number
  /** 1行の高さpx（固定。今の行の高さと合わせる）。 */
  rowHeight: number
  /** 見える分の前後に余分に描く行数。既定5。 */
  overscan?: number
  /** この行数以下は窓にせず全部描く。既定60。 */
  threshold?: number
  /** i番目の行の中身。 */
  renderRow: (index: number) => ReactNode
  className?: string
  /** 1行の包み（詰め物と行の両方に付く目印用）。 */
  itemClassName?: string
}) {
  const theme = useAdminTheme()
  const ref = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState<VirtualRange | null>(null)

  const enabled = theme === 'v8' && count > threshold
  // 初回は両テーマとも先頭分だけ（描画の不一致なし・最初の絵が速い）。
  const initiallyWindowed = count > threshold

  useEffect(() => {
    // テーマの状態は初回v7で来るため、地の値は直接読む。
    // v7 は効果で全部へ（settled は今までどおり）。V8 は窓を同期で求める。
    const v8 = document.documentElement.dataset?.theme === 'v8'
    if (!v8 || count <= threshold) {
      setRange((previous) => {
        if (previous && previous.start === 0 && previous.end === count) return previous
        return { start: 0, end: count }
      })
      return
    }
    const el = ref.current
    const compute = () => {
      const rect = el?.getBoundingClientRect()
      // 箱の上端が画面のどこにあるかで、箱の中の見える位置を求める。
      const scrollTop = Math.max(0, -(rect?.top ?? 0))
      const active = document.activeElement as HTMLElement | null
      const focusedAttr = active?.closest?.('[data-virtual-index]')?.getAttribute('data-virtual-index')
      const focusedIndex = focusedAttr === null || focusedAttr === undefined ? null : Number(focusedAttr)
      const next = virtualRange(count, rowHeight, scrollTop, window.innerHeight, overscan, focusedIndex)
      setRange((previous) => {
        if (previous && previous.start === next.start && previous.end === next.end) return previous
        return next
      })
    }
    compute()
    let frame = 0
    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0
          compute()
        })
      }
    }
    // 送るのは白い板（.main）の中。中の送りは window へ泡立たないので、捕まえる段で聞く。
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
    }
  }, [theme, count, rowHeight, overscan, threshold])

  // 少ない行：全部描く。多い行の初回は先頭分だけ描く。
  const start = range === null ? 0 : range.start
  const end = range === null ? Math.min(count, initiallyWindowed ? ESTIMATED_ROWS : count) : range.end
  const rows = useMemo(() => {
    const out: ReactNode[] = []
    for (let i = start; i < end; i++) out.push(<Fragment key={i}>{renderRow(i)}</Fragment>)
    return out
  }, [start, end, renderRow])

  // 窓が全部なら包みも詰め物も付けない（v7・少ない行は今までどおり）。
  const full = range !== null && range.start === 0 && range.end === count
  if (!enabled && (range === null || full)) {
    return <>{rows}</>
  }
  const top = start * rowHeight
  const bottom = Math.max(0, (count - end) * rowHeight)
  return (
    <div ref={ref} className={className}>
      {top > 0 ? <div aria-hidden="true" style={{ height: top }} /> : null}
      {rows.map((node, offset) => (
        <div key={start + offset} data-virtual-index={start + offset} className={itemClassName}>
          {node}
        </div>
      ))}
      {bottom > 0 ? <div aria-hidden="true" style={{ height: bottom }} /> : null}
    </div>
  )
}
