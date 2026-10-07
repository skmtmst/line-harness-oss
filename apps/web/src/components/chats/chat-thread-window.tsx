'use client'

/*
 * 会話の吹き出しを「下から積む」窓分けで描く（2026-10-07 速さの作業）。
 *
 * 吹き出しが 3,000〜10,000 個になると、全部描くと DOM が数万要素になり、
 * 入力1文字・定期の取り直し（5秒）のたびに全部を描き直して固まる。
 * 見えている所の前後だけを描く。
 *
 * - 開いたときは下（新しい方）から。いちばん下にいる間は新着で下へ付いていく。
 * - 上へ遡って上端の近くまで来たら古い分を読む（「前のメッセージ」も残す）。
 *   読み足しても、画像が後から読めても、見ている吹き出しは同じ場所に残る。
 * - 読み上げ：吹き出しの並びは feed、1つずつ article。「全 n 件中 m 件目」を
 *   aria-setsize / aria-posinset で伝える（まだ前がある間は全体数が分からないので -1）。
 * - キーボード：吹き出しに移ったら ↑↓・PageUp/PageDown で前後へ、Home/End で端へ。
 *   いちばん上でさらに ↑ を押すと古い分を読む。
 */
import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { useVirtualWindow, VIRTUAL_ITEM_ATTR } from './use-virtual-window'

export type ThreadMessage = { id: string }

type Props<M extends ThreadMessage> = {
  messages: M[]
  scrollerRef: RefObject<HTMLDivElement | null>
  hasMore: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  renderMessage: (message: M, index: number, list: M[]) => ReactNode
  label?: string
}

export default function ChatThreadWindow<M extends ThreadMessage>({
  messages, scrollerRef, hasMore, loadingOlder, onLoadOlder, renderMessage, label = 'メッセージ',
}: Props<M>) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const focusIndexRef = useRef<number | null>(null)
  const loadGuardRef = useRef(false)
  useEffect(() => { if (!loadingOlder) loadGuardRef.current = false }, [loadingOlder, messages.length])

  const loadOlder = useCallback(() => {
    if (!hasMore || loadingOlder || loadGuardRef.current) return
    loadGuardRef.current = true
    onLoadOlder()
  }, [hasMore, loadingOlder, onLoadOlder])

  const getKey = useCallback((index: number) => messages[index]?.id ?? String(index), [messages])
  const win = useVirtualWindow({
    count: messages.length,
    getKey,
    estimate: 76,
    overscan: 900,
    scrollerRef,
    contentRef,
    stickToBottom: true,
    onReachStart: hasMore ? loadOlder : undefined,
  })

  /* キーボードで移った先へ、描かれてからフォーカスを当てる。 */
  useEffect(() => {
    const index = focusIndexRef.current
    if (index === null) return
    const id = messages[index]?.id
    const el = id ? contentRef.current?.querySelector<HTMLElement>(`[${VIRTUAL_ITEM_ATTR}="${CSS.escape(id)}"]`) : null
    if (el) {
      focusIndexRef.current = null
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'nearest' })
    }
  })

  const moveFocus = (from: number, to: number) => {
    if (to < 0) {
      if (hasMore) loadOlder()
      return
    }
    const next = Math.min(messages.length - 1, to)
    if (next === from) return
    focusIndexRef.current = next
    win.scrollToIndex(next, 'nearest')
    // 既に描かれていれば、その場で当てる。
    const id = messages[next]?.id
    const el = id ? contentRef.current?.querySelector<HTMLElement>(`[${VIRTUAL_ITEM_ATTR}="${CSS.escape(id)}"]`) : null
    if (el) {
      focusIndexRef.current = null
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'nearest' })
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.getAttribute('role') !== 'article') return
    const index = Number(target.getAttribute('data-index'))
    if (!Number.isInteger(index)) return
    const page = Math.max(1, Math.floor((scrollerRef.current?.clientHeight ?? 600) / 76))
    let to: number | null = null
    if (event.key === 'ArrowDown') to = index + 1
    else if (event.key === 'ArrowUp') to = index - 1
    else if (event.key === 'PageDown') to = index + page
    else if (event.key === 'PageUp') to = Math.max(hasMore && index === 0 ? -1 : 0, index - page)
    else if (event.key === 'Home') to = 0
    else if (event.key === 'End') to = messages.length - 1
    if (to === null) return
    event.preventDefault()
    moveFocus(index, to)
  }

  const setSize = hasMore ? -1 : messages.length
  const rows: ReactNode[] = []
  for (let i = win.start; i < win.end; i += 1) {
    const message = messages[i]
    rows.push(
      <div
        key={message.id}
        {...{ [VIRTUAL_ITEM_ATTR]: message.id }}
        data-message-id={message.id}
        data-index={i}
        role="article"
        aria-posinset={i + 1}
        aria-setsize={setSize}
        /* 吹き出しへは1か所だけ Tab で入る（いちばん新しい吹き出し）。中は矢印で動く。 */
        tabIndex={i === messages.length - 1 ? 0 : -1}
        /* 行の間 8px は行の中に持つ（外の余白だと測った高さに入らない）。 */
        style={{ display: 'flow-root', paddingTop: i === 0 ? 0 : 8 }}
        className="rounded-mini focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        {renderMessage(message, i, messages)}
      </div>,
    )
  }

  return (
    <div
      ref={contentRef}
      role="feed"
      aria-label={label}
      aria-busy={loadingOlder}
      data-loaded={messages.length}
      onKeyDown={onKeyDown}
    >
      {win.padTop > 0 ? <div aria-hidden="true" style={{ height: win.padTop }} /> : null}
      {rows}
      {win.padBottom > 0 ? <div aria-hidden="true" style={{ height: win.padBottom }} /> : null}
    </div>
  )
}
