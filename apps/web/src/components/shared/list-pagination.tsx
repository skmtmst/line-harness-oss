import Pagination from './pagination'
import { DEFAULT_PAGE_SIZE } from './page-size-options'

/** 全件が手元にある一覧の件数と送り先を、同じページ範囲から描く。 */
export default function ListPagination({ total, page, pageSize, unit, onPageChange, disabled, ariaLabel }: {
  total: number
  page: number
  pageSize: number
  unit?: string
  onPageChange: (page: number) => void
  disabled?: boolean
  ariaLabel?: string
}) {
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : DEFAULT_PAGE_SIZE
  const count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
  const pageCount = Math.max(1, Math.ceil(count / size))
  const current = Number.isFinite(page) ? Math.min(pageCount, Math.max(1, Math.floor(page))) : 1
  return <Pagination page={current} pageCount={pageCount} onPageChange={onPageChange} disabled={disabled} ariaLabel={ariaLabel}
    range={{ total: Number.isFinite(total) ? count : null, first: count > 0 ? (current - 1) * size + 1 : 0, last: Math.min(current * size, count), unit }} />
}
