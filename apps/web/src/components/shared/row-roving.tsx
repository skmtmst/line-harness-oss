'use client'

import { useEffect, useRef, type HTMLAttributes, type ReactNode, type RefObject } from 'react'
import { useFlipRows } from '@/lib/use-live-reorder'

/*
 * 一覧の表で「1行に Tab は1回だけ止まる」口（動きの点検 20 番）。
 *
 * 1行の中に「選ぶ・並び替え・名前・…」の4つの止まりがあると、50行の一覧を
 * 抜けるのに 200 回 Tab を押すことになる。そこで行の名前（最初のリンク）だけを
 * Tab の止まりにし、残りは矢印キーで動く（WAI-ARIA の roving tabindex）。
 *
 *   Tab / Shift+Tab : 次・前の行の名前へ
 *   ← →            : 行の中の前・次の操作へ（行そのもの → 選ぶ → 並び替え → 名前 → …）
 *   ↑ ↓            : 上・下の行の同じ列へ（無ければ名前へ）
 *   Home / End      : 行の中の最初・最後へ
 *   Space           : 名前・行の上で押すと、その行を選ぶ（選ぶ欄がある行だけ）
 *   Esc             : 選択を外す（一括バー側の useEscapeToClearSelection が受け持つ）
 *
 * 決まり:
 *   - 入力欄・メニュー・窓の中のキーは奪わない
 *   - 自分で ↑↓ を使う部品（並び替えのつまみ）は data-roving-own="vertical" を付けると ↑↓ を譲る
 *   - 止まりから外したもの（tabindex=-1）には data-roving を付け、元から外れていたものと区別する
 *   - 名前にしたいものが最初のリンクでないときは data-row-primary を付ける
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]'

const OWNS_KEYS =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable=""], [contenteditable="true"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="menu"], [role="dialog"], [role="listbox"]'

/** 行の中で矢印キーで動く先。行そのもの（tabindex がある行）を先頭に、残りは並び順。 */
export function rowItems(row: HTMLTableRowElement): HTMLElement[] {
  const out: HTMLElement[] = []
  if (row.hasAttribute('tabindex') && (row.tabIndex >= 0 || row.hasAttribute('data-roving'))) out.push(row)
  for (const el of Array.from(row.querySelectorAll<HTMLElement>(FOCUSABLE))) {
    if (el.closest('[hidden], [inert], [aria-hidden="true"]')) continue
    // 元から Tab で止まらないもの（tabindex=-1 で、こちらが外したのではないもの）は数えない。
    if (el.getAttribute('tabindex') === '-1' && !el.hasAttribute('data-roving')) continue
    out.push(el)
  }
  return out
}

/** 行の名前（Tab の止まり）。data-row-primary → 最初のリンク → 行そのもの → 最初の操作。 */
export function rowPrimary(row: HTMLTableRowElement, items = rowItems(row)): HTMLElement | null {
  return (
    items.find((el) => el.hasAttribute('data-row-primary')) ??
    items.find((el) => el !== row && el.matches('a[href]')) ??
    items[0] ??
    null
  )
}

function bodyRows(body: HTMLTableSectionElement): HTMLTableRowElement[] {
  // body.rows を持たない環境（試験の DOM）でも動くよう、子の tr を数える。
  return Array.from(body.children).filter(
    (el): el is HTMLTableRowElement => el.tagName === 'TR' && !(el as HTMLElement).hidden,
  )
}

/** 行の名前だけを Tab の止まりにし、ほかを外す。同じ値なら触らない（見張りが回り続けないように）。 */
export function syncRowStops(body: HTMLTableSectionElement): void {
  for (const row of bodyRows(body)) {
    const items = rowItems(row)
    const primary = rowPrimary(row, items)
    for (const el of items) {
      const want = el === primary ? 0 : -1
      if (want === -1 && !el.hasAttribute('data-roving')) el.setAttribute('data-roving', '')
      if (el.tabIndex !== want) el.tabIndex = want
    }
  }
}

function cellIndexOf(el: HTMLElement): number {
  const cell = el.closest('td, th')
  return cell?.parentElement ? Array.prototype.indexOf.call(cell.parentElement.children, cell) : -1
}

/** 隣の行で同じ列にある操作。行そのものにいたら行へ、無ければ名前へ。 */
function sameColumnIn(row: HTMLTableRowElement, from: HTMLElement): HTMLElement | null {
  const items = rowItems(row)
  if (items.length === 0) return null
  if (from.tagName === 'TR') return items.includes(row) ? row : rowPrimary(row, items)
  const col = cellIndexOf(from)
  return items.find((el) => el !== row && cellIndexOf(el) === col) ?? rowPrimary(row, items)
}

export function handleRowKey(body: HTMLTableSectionElement, event: KeyboardEvent): void {
  if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return
  const target = event.target as HTMLElement | null
  if (!target || !body.contains(target)) return
  const row = target.closest('tr')
  if (!row || row.parentElement !== body) return
  if (target.closest(OWNS_KEYS)) return

  const items = rowItems(row)
  const index = items.indexOf(target)
  if (index < 0) return

  const go = (el: HTMLElement | null | undefined) => {
    if (!el) return
    event.preventDefault()
    el.focus()
  }

  switch (event.key) {
    case 'ArrowRight':
      if (index < items.length - 1) go(items[index + 1])
      return
    case 'ArrowLeft':
      if (index > 0) go(items[index - 1])
      return
    case 'Home':
      go(items[0])
      return
    case 'End':
      go(items[items.length - 1])
      return
    case 'ArrowDown':
    case 'ArrowUp': {
      if (target.closest('[data-roving-own="vertical"]')) return
      const rows = bodyRows(body)
      const step = event.key === 'ArrowDown' ? 1 : -1
      for (let i = rows.indexOf(row) + step; i >= 0 && i < rows.length; i += step) {
        const next = sameColumnIn(rows[i], target)
        if (next) {
          go(next)
          return
        }
      }
      // 端の行では動かないが、ページが勝手に流れないよう既定の動き（スクロール）は止める。
      event.preventDefault()
      return
    }
    case ' ': {
      if (target !== row && target !== rowPrimary(row, items)) return
      const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]:not([disabled])')
      if (!box) return
      event.preventDefault()
      // 行の Space（行を開く等）より「選ぶ」を先にする。
      event.stopPropagation()
      box.click()
      return
    }
    default:
  }
}

/**
 * 表の本体（tbody）に付ける。行の増減は見張って、そのたびに止まりを付け直す。
 * キーはネイティブで受け、メニューなどポータルの中のキーは届かない（DOM の外のため）。
 */
export function useRowRoving(ref: RefObject<HTMLTableSectionElement | null>, enabled = true): void {
  useEffect(() => {
    const body = ref.current
    if (!body || !enabled) return
    syncRowStops(body)
    let queued = false
    const observer = new MutationObserver(() => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        syncRowStops(body)
      })
    })
    observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['tabindex', 'disabled', 'href', 'hidden'] })
    const onKeyDown = (event: KeyboardEvent) => handleRowKey(body, event)
    body.addEventListener('keydown', onKeyDown)
    return () => {
      observer.disconnect()
      body.removeEventListener('keydown', onKeyDown)
    }
  }, [ref, enabled])
}

/**
 * 一覧の表の本体。ふつうの `<tbody>` と差し替えるだけで、1行に Tab は1回（行の名前）
 * だけ止まり、←→ で行の中、↑↓ で隣の行、Space で選ぶようになる。
 */
export function RovingTbody({
  children,
  reorderKey,
  ...bodyProps
}: Omit<HTMLAttributes<HTMLTableSectionElement>, 'children'> & {
  children?: ReactNode
  /** 並びの印（行の id を並べた文字）。変わると、`data-reorder-id` の行を前の位置から滑らせる。 */
  reorderKey?: string
}) {
  const ref = useRef<HTMLTableSectionElement>(null)
  useRowRoving(ref)
  useFlipRows(ref, reorderKey ?? '')
  return (
    <tbody ref={ref} {...bodyProps}>
      {children}
    </tbody>
  )
}
