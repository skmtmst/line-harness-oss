import Pagination from '@/components/shared/pagination'
import { ListPagePagination } from '@/components/templates'
import { formatNumber } from '@/lib/format'
import styles from './mileage.module.css'

export default function HistoryPager({ spentOnly, total, page, pageSize, items, pageCount, loading, setPage }: {
  spentOnly: boolean; total: number | null; page: number; pageSize: number; items: { length: number }
  pageCount: number; loading: boolean; setPage: (value: number) => void
}) {
  const first = (page - 1) * pageSize + 1
  const receivedLast = first + items.length - 1
  const last = total == null ? receivedLast : Math.min(spentOnly ? page * pageSize : receivedLast, total)
  return (
    <>
      <ListPagePagination>
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} disabled={loading} range={{ total, first, last }} />
      </ListPagePagination>
      {spentOnly ? <span className={styles.pagerCount}>{`このページのうち、使った・取り消し ${formatNumber(items.length)} 件`}</span> : null}
    </>
  )
}
