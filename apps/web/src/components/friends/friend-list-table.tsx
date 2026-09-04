'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import type { FriendListItem } from '@/lib/api'
import Pagination from '@/components/shared/pagination'
import FriendListRow from './friend-list-row'

export type FriendListColumn = 'support' | 'scenario' | 'latest' | 'tags' | 'last'

interface Props {
  friends: FriendListItem[]
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onToggleAll?: (select: boolean) => void
  onToggleAttention?: (friend: FriendListItem) => void
  total?: number
  page: number
  pageCount: number
  pageSize: number
  pageSizeOptions: readonly number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

const COLUMN_LABELS: Array<{ key: FriendListColumn; label: string }> = [
  { key: 'support', label: '対応・担当' },
  { key: 'scenario', label: 'シナリオ' },
  { key: 'latest', label: '最新メッセージ' },
  { key: 'tags', label: 'タグ・属性' },
  { key: 'last', label: '最終接触' },
]

export default function FriendListTable({
  friends,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  onToggleAttention,
  total = friends.length,
  page,
  pageCount,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: Props) {
  const checkboxRef = useRef<HTMLInputElement>(null)
  const [visible, setVisible] = useState<Set<FriendListColumn>>(() => new Set(COLUMN_LABELS.map((column) => column.key)))
  const [preferencesReady, setPreferencesReady] = useState(false)
  const selectedCount = friends.filter((friend) => selectedIds?.has(friend.id)).length
  const allSelected = friends.length > 0 && selectedCount === friends.length

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = selectedCount > 0 && !allSelected
  }, [allSelected, selectedCount])

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('friends.visibleColumns') ?? 'null') as unknown
      if (Array.isArray(stored)) {
        const allowed = stored.filter((key): key is FriendListColumn => COLUMN_LABELS.some((column) => column.key === key))
        setVisible(new Set(allowed))
      }
    } catch {
      // 保存値が壊れているときはV6の既定列を使う。
    } finally {
      setPreferencesReady(true)
    }
  }, [])

  useEffect(() => {
    if (!preferencesReady) return
    try {
      localStorage.setItem('friends.visibleColumns', JSON.stringify([...visible]))
    } catch {
      // localStorage unavailable
    }
  }, [preferencesReady, visible])

  const gridTemplateColumns = useMemo(() => [
    '36px',
    '36px',
    'minmax(180px,1.3fr)',
    visible.has('support') ? 'minmax(125px,.9fr)' : null,
    visible.has('scenario') ? 'minmax(85px,.65fr)' : null,
    visible.has('latest') ? 'minmax(150px,1.45fr)' : null,
    visible.has('tags') ? 'minmax(150px,1.35fr)' : null,
    visible.has('last') ? '90px' : null,
  ].filter(Boolean).join(' '), [visible])

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  return (
    <section className="flex min-h-155 flex-col overflow-hidden rounded-card border border-hairline bg-canvas shadow-card" data-design="V6FriendTable" data-design-node="k4Hz0X">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-hairline px-4">
        <h2 className="whitespace-nowrap text-sm font-bold text-ink">
          友だち一覧 <span className="ml-1 text-xs font-bold text-accent">{total.toLocaleString('ja-JP')}件</span>
        </h2>
        <div className="flex items-center gap-4 text-xs">
          <span className="whitespace-nowrap text-ink-faint">{selectedCount}件選択中</span>
          <details className="relative">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-2 whitespace-nowrap font-semibold text-action">
              表示項目を編集
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-52 rounded-card border border-hairline bg-canvas p-2 shadow-lg">
              {COLUMN_LABELS.map((column) => (
                <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-2 text-xs text-ink-secondary hover:bg-canvas-sunken">
                  <input
                    type="checkbox"
                    checked={visible.has(column.key)}
                    onChange={(event) => setVisible((previous) => {
                      const next = new Set(previous)
                      if (event.target.checked) next.add(column.key)
                      else next.delete(column.key)
                      return next
                    })}
                    className="h-4 w-4 accent-accent"
                  />
                  {column.label}
                </label>
              ))}
            </div>
          </details>
          <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="v6-select h-10 min-w-34.5 rounded-control border border-hairline bg-canvas text-sm font-semibold text-ink">
            {pageSizeOptions.map((size) => <option key={size} value={size}>{size}件表示</option>)}
          </select>
        </div>
      </div>

      <div className="grid h-11 shrink-0 items-center gap-2 border-b border-hairline bg-canvas-sunken px-3 text-micro font-semibold text-ink-secondary" style={{ gridTemplateColumns }}>
        <div>
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={allSelected}
            onChange={(event) => onToggleAll?.(event.target.checked)}
            aria-label="表示中の友だちをすべて選ぶ"
            className="h-4 w-4 cursor-pointer accent-accent"
          />
        </div>
        <Star aria-label="注目" className="h-4 w-4 text-ink-faint" />
        <div className="truncate">友だち</div>
        {visible.has('support') ? <div className="truncate">対応・担当</div> : null}
        {visible.has('scenario') ? <div className="truncate" data-column="scenario">シナリオ</div> : null}
        {visible.has('latest') ? <div className="truncate">最新メッセージ</div> : null}
        {visible.has('tags') ? <div className="truncate">タグ・属性</div> : null}
        {visible.has('last') ? <div className="truncate text-center">最終接触</div> : null}
      </div>

      <div className="min-h-0 flex-1">
        {friends.length === 0 ? (
          <div className="flex h-full min-h-77.5 flex-col items-center justify-center px-6 text-center">
            <p className="text-sm font-semibold text-ink-secondary">条件に合う友だちが見つかりません</p>
            <p className="mt-1 text-xs text-ink-faint">検索条件を外すか、別のキーワードでお試しください。</p>
          </div>
        ) : friends.map((friend) => (
          <FriendListRow
            key={friend.id}
            friend={friend}
            selected={selectedIds?.has(friend.id)}
            onToggleSelect={() => onToggleSelect?.(friend.id)}
            onToggleAttention={() => onToggleAttention?.(friend)}
            visibleColumns={visible}
            gridTemplateColumns={gridTemplateColumns}
          />
        ))}
      </div>

      <div className="flex h-12 shrink-0 items-center justify-between border-t border-hairline px-4">
        <span className="text-xs text-ink-faint">{rangeStart}〜{rangeEnd}件 / 全{total.toLocaleString('ja-JP')}件</span>
        <Pagination page={page} pageCount={pageCount} onPageChange={onPageChange} ariaLabel="友だち一覧のページ" />
      </div>
    </section>
  )
}
