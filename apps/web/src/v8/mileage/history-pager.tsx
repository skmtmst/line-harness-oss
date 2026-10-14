import Pagination, { paginationSummary } from '@/components/shared/pagination'
import { formatNumber } from '@/lib/format'

export default function HistoryPager({ spentOnly, total, page, pageSize, items, pageCount, loading, setPage }: {
  spentOnly: boolean; total: number | null; page: number; pageSize: number; items: { length: number }
  pageCount: number; loading: boolean; setPage: (value: number) => void
}) {
  return (
    <Pagination page={page} pageCount={Math.max(1, pageCount)} onPageChange={setPage} disabled={loading}
      range={!spentOnly ? { total, first: (page - 1) * pageSize + 1, last: total === null ? (page - 1) * pageSize + items.length : Math.min(page * pageSize, total) } : undefined}
      summary={spentOnly ? `${total === null ? '—件' : paginationSummary(total, (page - 1) * pageSize + 1, Math.min(page * pageSize, total))}のうち、使った・取り消し ${formatNumber(items.length)} 件` : undefined} />
  )
}
