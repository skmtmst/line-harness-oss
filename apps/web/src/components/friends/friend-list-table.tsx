'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Star } from 'lucide-react'
import type { FriendListItem } from '@/lib/api'
import MenuPortal from '@/components/shared/menu-portal'
import Pagination from '@/components/shared/pagination'
import Checkbox from '@/components/shared/checkbox'
import ListState from '@/components/shared/list-state'
import { RefreshCover } from '@/components/shared/refresh-cover'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import ListRange from '@/components/ui/list-range'
import PageSizeSelect from '@/components/ui/page-size-select'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { VirtualRows } from '@/components/shared/virtual-rows'
import FriendListRow, { FriendListCard } from './friend-list-row'
import { formatNumber } from '@/lib/format'
import './friend-list-table.css'

export type FriendListColumn = 'support' | 'scenario' | 'latest' | 'tags' | 'source' | 'last'

interface Props {
  toolbarFilters?: ReactNode
  sortControl?: ReactNode
  friends: FriendListItem[]
  status?: 'loading' | 'ready' | 'error'
  /*
   * 読み直し中（★V7 sTJsh §2）。行が残っている再取得では一覧を
   * 消さず、表を 0.55 に薄めて上に 2px の線の帯を出す。
   */
  refreshing?: boolean
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
  toolbarFilters,
  sortControl,
  friends,
  status = 'ready',
  refreshing = false,
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
  const [columnsOpen, setColumnsOpen] = useState(false)
  const columnsButtonRef = useRef<HTMLButtonElement>(null)
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

  const columnTracks = useMemo(() => ([
    { key: 'check', track: '36px' },
    { key: 'star', track: '36px' },
    { key: 'friend', track: 'minmax(0,1.6fr)' },
    { key: 'support', track: 'minmax(0,1.1fr)' },
    { key: 'scenario', track: 'minmax(0,.7fr)' },
    { key: 'latest', track: 'minmax(0,1.2fr)' },
    { key: 'tags', track: 'minmax(0,1.1fr)' },
    { key: 'source', track: 'minmax(0,.6fr)' },
    { key: 'last', track: '70px' },
    { key: 'actions', track: '36px' },
  ].filter((column) => column.key === 'check' || column.key === 'star' || column.key === 'friend' || column.key === 'actions' || visible.has(column.key as FriendListColumn))), [visible])

  const gridTemplateColumns = columnTracks.map((column) => column.track).join(' ')
  /*
   * ★V8（夕14・WIDTHS-20261001）：1280px 幅で右の列が板の外に切れる。
   * AGENTS.md の順番（横送りより先に「大事でない列を隠す」）に従い、
   * v8 の 1366px 未満では流入元列を隠す。流入元は追加時の計測値で、
   * 詳細の「友だち情報」にあるので一覧から消しても辿れる。
   */
  const narrowGridTemplateColumns = columnTracks.filter((column) => column.key !== 'source').map((column) => column.track).join(' ')

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  /*
   * ★V8：多い行は窓で描く（M10・2,000行対策）。
   * 机（lg）では行の高さが78pxでそろっているので窓に入れる。
   * 手（lg未満）の札は高さがばらばらのため窓にせず、見える側だけ描く。
   * v7・測る前は今までどおり両方描く（描画の不一致を起こさない）。
   */
  const theme = useAdminTheme()
  const [desktop, setDesktop] = useState<boolean | null>(null)
  useEffect(() => {
    // テーマの状態は初回v7で来るため、地の値は直接読む（中間の全描画を出さない）。
    if (document.documentElement.dataset?.theme !== 'v8') {
      setDesktop(null)
      return
    }
    const query = window.matchMedia('(min-width: 1024px)')
    const apply = () => setDesktop(query.matches)
    apply()
    query.addEventListener?.('change', apply)
    return () => query.removeEventListener?.('change', apply)
  }, [theme])
  const singleBranch = theme === 'v8' && desktop !== null
  const windowing = singleBranch && desktop === true && friends.length > 60
  /*
   * 初回は両テーマとも先頭30行だけ（描画の不一致なし・最初の絵が速い）。
   * 効果で広げる：v7は全部（settledは今までどおり）・V8は窓か片枝へ。
   */
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    setExpanded(true)
  }, [friends])
  const firstFriends = !expanded && friends.length > 60 ? friends.slice(0, 30) : friends

  return (
    <section
      className="overflow-hidden bg-canvas"
      style={{ '--friend-cols': gridTemplateColumns, '--friend-cols-narrow': narrowGridTemplateColumns } as React.CSSProperties}
      data-design="V8FriendTable" data-design-node="ywJ5H" aria-busy={status === 'loading' || undefined}
    >
      {/*
        FRIEND-17: 狭い幅ではツールバーの右側（件数・表示項目）を折り返して
        隠さない。h-14 の固定高は lg 以上にだけ掛ける。
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-hairline px-4 py-3 lg:h-14 lg:flex-nowrap lg:py-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">{toolbarFilters ?? <span className="text-xs text-ink-faint">{status === 'ready' ? `${formatNumber(total)}件` : '—'}</span>}</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {/* 選んでいる時だけ出す（★V7：0件の時は意味が無い）。 */}
          {selectedCount > 0 ? <span className="whitespace-nowrap font-semibold text-accent-deep">{selectedCount}件選択中</span> : null}
          <span className="relative inline-flex">
            <button
              ref={columnsButtonRef}
              type="button"
              aria-expanded={columnsOpen}
              onClick={() => setColumnsOpen((current) => !current)}
              className="flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap font-semibold text-action"
            >
              表示項目を編集
            </button>
            <MenuPortal
              open={columnsOpen}
              align="end"
              getAnchor={() => columnsButtonRef.current}
              onClose={() => setColumnsOpen(false)}
            >
              <div
                className="w-52 rounded-card border border-hairline bg-canvas p-2 shadow-float"
                data-design-node="CYJ0L"
                // 最上層では absolute 指定を無効にする（位置は器が決める）。
                style={{ position: 'static' }}
              >
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
            </MenuPortal>
          </span>
          {/* #668: 件数の選び口は他の一覧と同じ「表示件数」セレクト。 */}
          <PageSizeSelect
            data-qa-open="LT8RS"
            value={pageSize}
            onChange={onPageSizeChange}
            options={[...pageSizeOptions]}
          />
          {sortControl}
        </div>
      </div>

      {/* FRIEND-17: 列見出しは表と対になるため、カード表示の幅では出さない。 */}
      <div data-friend-cols className="hidden h-11 shrink-0 items-center gap-2 border-b border-hairline bg-canvas-sunken px-3 text-micro font-semibold text-ink-secondary lg:grid">
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
        {visible.has('latest') ? <div className="truncate">最新のメッセージ</div> : null}
        {visible.has('tags') ? <div className="truncate">タグ</div> : null}
        {visible.has('source') ? <div className="truncate" data-column="source">流入元</div> : null}
        {visible.has('last') ? <div className="truncate text-center">最終接触</div> : null}
        <span className="sr-only">操作</span>
      </div>

      <RefreshCover refreshing={refreshing}>
      <div>
        {status === 'loading' ? (
          /*
           * ★V7 仕上げ §3: 表は中身の代わりに同じ形の骨組みを出す。
           * 列の見出しは上にそのまま出ているので、ここは行だけ。
           * 0.3 秒より早く来たら出さない（DelayedSkeleton）。
           */
          <DelayedSkeleton
            loading
            skeleton={
              <div aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((row) => (
                  <div key={row} className="flex items-center gap-3 border-b border-hairline px-3 py-3">
                    <Skeleton className="h-5 w-5 shrink-0" />
                    <Skeleton circle className="h-9 w-9 shrink-0" />
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                ))}
              </div>
            }
          />
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
        ) : windowing && expanded ? (
          /*
            ★V8：多い行は窓で描く（M10・2,000行対策）。
            机の行は78pxでそろっているので窓に入れる。札は描かない
            （窓の高さが合わなくなるため。手では下の片枝描画を使う）。
          */
          <VirtualRows
            count={friends.length}
            rowHeight={78}
            renderRow={(index) => {
              const friend = friends[index]
              return (
                <FriendListRow
                  friend={friend}
                  selected={selectedIds?.has(friend.id)}
                  onToggleSelect={() => onToggleSelect?.(friend.id)}
                  onToggleAttention={() => onToggleAttention?.(friend)}
                  visibleColumns={visible}
                />
              )
            }}
          />
        ) : firstFriends.map((friend) => (
          /*
            FRIEND-17: lg未満はカード、lg以上はグリッド行。
            V8では見える側だけ描く（v7・初回は両方描いてCSSで分ける）。
            初回は先頭30行だけ（両テーマ同一・描画の不一致なし）。
            列の表示切替（visible）は両側で効く。
          */
          <div key={friend.id} className="contents">
            {(!singleBranch || desktop === false) && (
              <div className="lg:hidden">
                <FriendListCard
                  friend={friend}
                  selected={selectedIds?.has(friend.id)}
                  onToggleSelect={() => onToggleSelect?.(friend.id)}
                  onToggleAttention={() => onToggleAttention?.(friend)}
                  visibleColumns={visible}
                />
              </div>
            )}
            {(!singleBranch || desktop === true) && (
              <div className="hidden lg:block">
                <FriendListRow
                  friend={friend}
                  selected={selectedIds?.has(friend.id)}
                  onToggleSelect={() => onToggleSelect?.(friend.id)}
                  onToggleAttention={() => onToggleAttention?.(friend)}
                  visibleColumns={visible}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/*
        ★V8（jX2Uw）：ページ送りの帯が「件数＋ボタン」を持つ形。
        v7 は帯の外に件数を出す（data-pagebar-out が v8 で隠す）、
        v8 は帯の中の summary に出す。
      */}
      <div data-pagebar className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-hairline px-4 py-2 lg:h-12 lg:flex-nowrap lg:py-0">
        <span data-pagebar-out>
          <ListRange total={total} first={rangeStart} last={rangeEnd} />
        </span>
        <Pagination
          page={page}
          pageCount={pageCount}
          onPageChange={onPageChange}
          disabled={status !== 'ready'}
          ariaLabel="友だち一覧のページ"
          summary={status === 'ready' ? <ListRange bare total={total} first={rangeStart} last={rangeEnd} /> : <span>—</span>}
        />
      </div>
      </RefreshCover>
    </section>
  )
}
