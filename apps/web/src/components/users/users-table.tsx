'use client'

import UserRow, { type UserRowData } from './user-row'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import { TableHeadRow, Th } from '@/components/shared/table'

const fmt = new Intl.NumberFormat('ja-JP')

const ACCOUNT_BADGE_COLORS = [
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-slate-100 text-slate-700',
]

interface Props {
  rows: UserRowData[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  error: boolean
  onRetry: () => void
  onPageChange: (page: number) => void
  onOpenMergedPerson?: (personId: string) => void
}

export default function UsersTable({
  rows,
  total,
  page,
  pageSize,
  loading,
  error,
  onRetry,
  onPageChange,
  onOpenMergedPerson,
}: Props) {
  const accountColorMap = new Map<string, string>()
  for (const row of rows) {
    for (const a of row.accounts) {
      if (!accountColorMap.has(a.accountId)) {
        accountColorMap.set(
          a.accountId,
          ACCOUNT_BADGE_COLORS[accountColorMap.size % ACCOUNT_BADGE_COLORS.length],
        )
      }
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  const countAvailable = !loading && !error

  return (
    <div className="overflow-hidden rounded-v6-card border border-hairline bg-canvas shadow-v6-card">
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[18%]" />
          <col className="w-[18%]" />
          <col className="w-[20%]" />
          <col className="w-[14%]" />
          <col className="w-[11%]" />
          <col className="w-[10%]" />
          <col className="w-[9%]" />
        </colgroup>
        <thead className="border-b border-hairline bg-v6-surface-strong text-left text-micro font-semibold text-v6-ink-secondary">
          <TableHeadRow>
            <Th>統合ユーザー</Th>
            <Th>連絡先</Th>
            <Th>紐付くアカウント</Th>
            <Th>UID</Th>
            <Th>最終接触</Th>
            <Th>重複配信</Th>
            <Th align="right">操作</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="p-4">
                {loading ? (
                  <ListState kind="loading" />
                ) : error ? (
                  <ListState
                    kind="error"
                    title="統合ユーザーを表示できませんでした"
                    description="再計算するか、時間をおいてもう一度お試しください。"
                    onRetry={onRetry}
                  />
                ) : (
                  <ListState
                    kind="empty"
                    title="条件に合う統合ユーザーがいません"
                    description="検索条件を変えてお試しください。"
                  />
                )}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <UserRow
                key={row.identityKey}
                row={row}
                accountColorMap={accountColorMap}
                onOpenMergedPerson={onOpenMergedPerson}
              />
            ))
          )}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-v6-divider px-4 py-3 text-sm text-v6-ink-secondary">
        <span>
          {countAvailable
            ? `${fmt.format(total)}人中 ${fmt.format(start)}〜${fmt.format(end)}人`
            : '—人'}
        </span>
        <Pagination
          page={page}
          pageCount={totalPages}
          onPageChange={onPageChange}
          disabled={loading || error}
          ariaLabel="統合ユーザーのページ送り"
        />
      </div>
    </div>
  )
}
