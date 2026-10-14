import Pagination from '@/components/shared/pagination'
import { formatNumber } from '@/lib/format'
import styles from './mileage.module.css'

export default function HistoryPager({ spentOnly, total, page, pageSize, items, pageCount, loading, setPage }: {
  spentOnly: boolean; total: number | null; page: number; pageSize: number; items: { length: number }
  pageCount: number; loading: boolean; setPage: (value: number) => void
}) {
  return (
    <>
      <div className={styles.pagerRow}>
        <span className={styles.pagerCount}>
          {spentOnly
            ? `${formatNumber(total ?? 0)} 件中 ${(page - 1) * pageSize + 1}〜${Math.min(page * pageSize, total ?? 0)} 件のうち、使った・取り消し ${formatNumber(items.length)} 件`
            : `${formatNumber(total ?? 0)} 件中 ${(page - 1) * pageSize + 1}〜${Math.min(page * pageSize, total ?? 0)} 件`}
        </span>
        {pageCount > 1 ? <Pagination page={page} pageCount={pageCount} onPageChange={setPage} disabled={loading} /> : null}
      </div>
    </>
  )
}
