'use client'

/*
 * 会話の頭の下に差す「会話の中を探す」帯（V8.pen 枠 v7GV2 の f64Ok）。
 * 探す欄（緑の枠）・「n件中 m件目」・↑・↓・×。
 * Enter＝古い方（↑）、Shift+Enter＝新しい方（↓）、Esc＝閉じる。
 */
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import IconButton from '@/components/shared/icon-button'
import { CHAT_SEARCH_MAX_CHARS, type ChatSearch } from './use-chat-search'
import styles from './chat-search-bar.module.css'

export function chatSearchCountText(search: Pick<ChatSearch, 'query' | 'status' | 'total' | 'index'>): string {
  if (!search.query.trim()) return ''
  if (search.status === 'loading') return '探しています…'
  if (search.status === 'error') return '探せませんでした'
  if (search.status !== 'ready') return ''
  if (search.total === 0) return '見つかりません'
  return `${search.total.toLocaleString('ja-JP')}件中 ${(search.index + 1).toLocaleString('ja-JP')}件目`
}

export default function ChatSearchBar({ search, focusSeq = 0, busy = false }: {
  search: ChatSearch
  /** 増えたら探す欄へ入る（🔍・⌘F をもう一度押したとき） */
  focusSeq?: number
  /** 昔の吹き出しを読み込んでいる間 */
  busy?: boolean
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusSeq])

  const ready = search.status === 'ready' && search.total > 0
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      search.close()
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (event.shiftKey) search.newer()
      else search.older()
    }
  }
  const count = busy ? '読み込んでいます…' : chatSearchCountText(search)

  return (
    <div className={styles.band} role="search" aria-label="会話の中を探す" data-design-node="f64Ok">
      <label className={styles.field}>
        <Search aria-hidden="true" className={styles.fieldIcon} />
        <input
          ref={inputRef}
          type="search"
          className={styles.input}
          value={search.query}
          maxLength={CHAT_SEARCH_MAX_CHARS}
          placeholder="会話の中を探す"
          aria-label="会話の中を探す"
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>
      <span className={styles.count} role="status" aria-live="polite">{count}</span>
      <IconButton
        className={styles.button}
        aria-label="前の当たりへ（古い方）"
        disabled={!ready || busy || search.index <= 0}
        onClick={search.older}
      >
        <ChevronUp aria-hidden="true" />
      </IconButton>
      <IconButton
        className={styles.button}
        aria-label="次の当たりへ（新しい方）"
        disabled={!ready || busy || search.index >= search.total - 1}
        onClick={search.newer}
      >
        <ChevronDown aria-hidden="true" />
      </IconButton>
      <IconButton className={styles.button} aria-label="探すのをやめる" onClick={search.close}>
        <X aria-hidden="true" />
      </IconButton>
    </div>
  )
}
