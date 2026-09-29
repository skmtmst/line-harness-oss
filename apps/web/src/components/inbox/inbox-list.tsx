'use client'

import InboxRow, { type InboxRowData } from './inbox-row'
import ListRange from '@/components/ui/list-range'
import Pagination from '@/components/shared/pagination'
import ListState from '@/components/shared/list-state'



interface Props {
  rows: InboxRowData[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  onPageChange: (page: number) => void
}

export default function InboxList({
  rows,
  total,
  page,
  pageSize,
  loading,
  onPageChange,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)

  return (
    <div className="overflow-hidden rounded-lg bg-canvas shadow-sm ring-1 ring-hairline">
      {rows.length === 0 && !loading ? (
        <ListState
          kind="empty"
          title="未対応はありません"
          description="新しい受信があると、ここに並びます。"
        />
      ) : (
        <div>
          {rows.map((row) => (
            <InboxRow key={row.friendId} row={row} />
          ))}
        </div>
      )}
      {total > 0 && (
        <div className="flex items-center justify-between border-t border-divider-soft px-4 py-3 text-sm text-ink-secondary">
          <ListRange total={total} first={start} last={end} />
          <Pagination page={page} pageCount={totalPages} onPageChange={onPageChange} disabled={loading} />
        </div>
      )}
    </div>
  )
}
