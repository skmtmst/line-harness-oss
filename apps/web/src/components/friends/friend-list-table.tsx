'use client'

import { useEffect, useMemo, useState } from 'react'
import { Star } from 'lucide-react'
import type { FriendListItem } from '@/lib/api'
import Pagination from '@/components/shared/pagination'
import Checkbox from '@/components/shared/checkbox'
import ListState from '@/components/shared/list-state'
import ListRange from '@/components/ui/list-range'
import PageSizeSelect from '@/components/ui/page-size-select'
import FriendListRow, { FriendListCard } from './friend-list-row'

export type FriendListColumn = 'support' | 'scenario' | 'latest' | 'tags' | 'source' | 'last'

interface Props {
  friends: FriendListItem[]
  status?: 'loading' | 'ready' | 'error'
  emptyTitle?: string
  emptyDescription?: string
  onRetry?: () => void
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
  // N-038: 流入元は追加時に一度だけ付く計測値。一覧に列が無く、
  // どの施策から来た人か一覧では読めなかった。
  { key: 'source', label: '流入元' },
  { key: 'last', label: '最終接触' },
]

export default function FriendListTable({
  friends,
  status = 'ready',
  emptyTitle = '条件に合う友だちが見つかりません',
  emptyDescription = '検索条件を外すか、別のキーワードでお試しください。',
  onRetry,
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
  const [visible, setVisible] = useState<Set<FriendListColumn>>(() => new Set(COLUMN_LABELS.map((column) => column.key)))
  const [preferencesReady, setPreferencesReady] = useState(false)
  const selectedCount = friends.filter((friend) => selectedIds?.has(friend.id)).length
  const allSelected = friends.length > 0 && selectedCount === friends.length

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
    visible.has('source') ? 'minmax(110px,.8fr)' : null,
    visible.has('last') ? '90px' : null,
  ].filter(Boolean).join(' '), [visible])

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  return (
    <section className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-card" data-design="V6FriendTable" data-design-node="k4Hz0X">
      {/*
        FRIEND-17: 狭い幅ではツールバーの右側（件数・表示項目）を折り返して
        隠さない。h-14 の固定高は lg 以上にだけ掛ける。
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-hairline px-4 py-3 lg:h-14 lg:flex-nowrap lg:py-0">
        <h2 className="whitespace-nowrap text-sm font-bold text-ink">
          {/*
            未取得の件数は0件に見せない（絞り込みの行の件数を消した後は、
            この見出しがその役目を持つ）。取れるまでは「—」。
          */}
          友だち一覧 <span className="ml-1 text-xs font-bold text-ink-faint">{status === 'ready' ? `${total.toLocaleString('ja-JP')}件` : '—'}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {/* 選んでいる時だけ出す（★V7：0件の時は意味が無い）。 */}
          {selectedCount > 0 ? <span className="whitespace-nowrap font-semibold text-accent-deep">{selectedCount}件選択中</span> : null}
          <details className="relative">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-2 whitespace-nowrap font-semibold text-action">
              表示項目を編集
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-52 rounded-card border border-hairline bg-canvas p-2 shadow-float">
              {COLUMN_LABELS.map((column) => (
                <div key={column.key} className="rounded-control px-2 py-2 hover:bg-canvas-sunken">
                  {/* ★V7 共通 チェックボックス（gvjpx）。 */}
                  <Checkbox
                    checked={visible.has(column.key)}
                    onCheckedChange={(checked) => setVisible((previous) => {
                      const next = new Set(previous)
                      if (checked) next.add(column.key)
                      else next.delete(column.key)
                      return next
                    })}
                  >
                    {column.label}
                  </Checkbox>
                </div>
              ))}
            </div>
          </details>
          {/* #668: 件数の選び口は他の一覧と同じ「表示件数」セレクト。 */}
          <PageSizeSelect
            data-qa-open="LT8RS"
            value={pageSize}
            onChange={onPageSizeChange}
            options={[...pageSizeOptions]}
          />
        </div>
      </div>

      {/* FRIEND-17: 列見出しは表と対になるため、カード表示の幅では出さない。 */}
      <div className="hidden h-11 shrink-0 items-center gap-2 border-b border-hairline bg-canvas-sunken px-3 text-micro font-semibold text-ink-secondary lg:grid" style={{ gridTemplateColumns }}>
        <div>
          {/* ★V7 共通 チェックボックス（gvjpx）。一部だけ選んでいるときは「―」。 */}
          <Checkbox
            checked={allSelected}
            indeterminate={selectedCount > 0 && !allSelected}
            onCheckedChange={(checked) => onToggleAll?.(checked)}
            aria-label="表示中の友だちをすべて選ぶ"
          />
        </div>
        <Star aria-label="注目" className="h-4 w-4 text-ink-faint" />
        <div className="truncate">友だち</div>
        {visible.has('support') ? <div className="truncate">対応・担当</div> : null}
        {visible.has('scenario') ? <div className="truncate" data-column="scenario">シナリオ</div> : null}
        {visible.has('latest') ? <div className="truncate">最新メッセージ</div> : null}
        {visible.has('tags') ? <div className="truncate">タグ・属性</div> : null}
        {visible.has('source') ? <div className="truncate" data-column="source">流入元</div> : null}
        {visible.has('last') ? <div className="truncate text-center">最終接触</div> : null}
      </div>

      <div>
        {status === 'loading' ? (
          <div className="flex items-center justify-center bg-canvas-sunken/30 px-6 py-10">
            <ListState kind="loading" title="読み込んでいます" description="このまま少しお待ちください。" />
          </div>
        ) : status === 'error' ? (
          <div className="flex items-center justify-center bg-canvas-sunken/30 px-6 py-10">
            <ListState
              kind="error"
              title="表示できませんでした"
              description="再読み込みしても直らないときは、エラー報告へお知らせください。"
              onRetry={onRetry}
            />
          </div>
        ) : friends.length === 0 ? (
          <div className="flex items-center justify-center bg-canvas-sunken/30 px-6 py-10">
            <ListState kind="empty" title={emptyTitle} description={emptyDescription} />
          </div>
        ) : friends.map((friend) => (
          /*
            FRIEND-17: lg未満はカード、lg以上はグリッド行。
            両方描いてCSSで分ける。列の表示切替（visible）は両側で効く。
          */
          <div key={friend.id} className="contents">
            <div className="lg:hidden">
              <FriendListCard
                friend={friend}
                selected={selectedIds?.has(friend.id)}
                onToggleSelect={() => onToggleSelect?.(friend.id)}
                onToggleAttention={() => onToggleAttention?.(friend)}
                visibleColumns={visible}
              />
            </div>
            <div className="hidden lg:block">
              <FriendListRow
                friend={friend}
                selected={selectedIds?.has(friend.id)}
                onToggleSelect={() => onToggleSelect?.(friend.id)}
                onToggleAttention={() => onToggleAttention?.(friend)}
                visibleColumns={visible}
                gridTemplateColumns={gridTemplateColumns}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-hairline px-4 py-2 lg:h-12 lg:flex-nowrap lg:py-0">
        <ListRange total={total} first={rangeStart} last={rangeEnd} />
        <Pagination page={page} pageCount={pageCount} onPageChange={onPageChange} disabled={status !== 'ready'} ariaLabel="友だち一覧のページ" />
      </div>
    </section>
  )
}
