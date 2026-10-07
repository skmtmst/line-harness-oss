'use client'

/*
 * 受信箱の会話の一覧を窓分けで描く（2026-10-07 速さの作業）。
 *
 * 1ページ 200 件でも、行ごとに 20 前後の要素があるので開いた時点で DOM が
 * 4,000 を超える。「さらに読み込む」で 10,000 件まで足すと 20 万要素になり、
 * 入力・定期の取り直し（5秒）のたびに固まる。見えている所の前後だけ描く。
 *
 * - 読み上げ：一覧は list、行は listitem。「全 n 件中 m 件目」を
 *   aria-setsize / aria-posinset で伝える（続きがある間は全体数が分からないので -1）。
 * - キーボード：行のボタンで ↑↓ を押すと前後の行へ。Home/End で端へ。
 *   描かれていない行へもスクロールしてから移る。
 * - 描いていない行はブラウザの「ページ内検索」で見つからない。名前・本文は
 *   一覧の上の検索欄で探す（本文まで口側で探す）。
 */
import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { useVirtualWindow, VIRTUAL_ITEM_ATTR } from './use-virtual-window'

export type ChatListWindowItem = { key: string; render: () => ReactNode }

type Props = {
  items: ChatListWindowItem[]
  scrollerRef: RefObject<HTMLDivElement | null>
  /** 続きがまだある（全体数が分からない） */
  hasMore: boolean
  label?: string
}

export default function ChatListWindow({ items, scrollerRef, hasMore, label = '会話の一覧' }: Props) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const focusKeyRef = useRef<string | null>(null)
  const getKey = useCallback((index: number) => items[index]?.key ?? String(index), [items])
  const win = useVirtualWindow({ count: items.length, getKey, estimate: 92, overscan: 600, scrollerRef, contentRef })

  const focusRow = (key: string) => {
    const row = contentRef.current?.querySelector<HTMLElement>(`[${VIRTUAL_ITEM_ATTR}="${CSS.escape(key)}"]`)
    const button = row?.querySelector<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')
    if (!button) return false
    button.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'nearest' })
    return true
  }

  useEffect(() => {
    const key = focusKeyRef.current
    if (key && focusRow(key)) focusKeyRef.current = null
  })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const row = (event.target as HTMLElement).closest<HTMLElement>(`[${VIRTUAL_ITEM_ATTR}]`)
    if (!row) return
    const index = Number(row.getAttribute('data-index'))
    if (!Number.isInteger(index)) return
    const to = event.key === 'ArrowDown' ? index + 1
      : event.key === 'ArrowUp' ? index - 1
        : event.key === 'Home' ? 0 : items.length - 1
    if (to < 0 || to >= items.length || to === index) return
    event.preventDefault()
    const key = items[to].key
    win.scrollToIndex(to, 'nearest')
    if (!focusRow(key)) focusKeyRef.current = key
  }

  const setSize = hasMore ? -1 : items.length
  const rows: ReactNode[] = []
  for (let i = win.start; i < win.end; i += 1) {
    const item = items[i]
    rows.push(
      <div
        key={item.key}
        {...{ [VIRTUAL_ITEM_ATTR]: item.key }}
        data-inbox-row=""
        data-index={i}
        role="listitem"
        aria-posinset={i + 1}
        aria-setsize={setSize}
        style={{ display: 'flow-root' }}
      >
        {item.render()}
      </div>,
    )
  }

  return (
    <div ref={contentRef} role="list" aria-label={label} data-total={items.length} onKeyDown={onKeyDown}>
      {win.padTop > 0 ? <div aria-hidden="true" style={{ height: win.padTop }} /> : null}
      {rows}
      {win.padBottom > 0 ? <div aria-hidden="true" style={{ height: win.padBottom }} /> : null}
    </div>
  )
}
