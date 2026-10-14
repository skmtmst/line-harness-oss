import Pagination from '@/components/shared/pagination'
import { ListPagePagination } from '@/components/templates'

export const PAYMENT_SECURITY_NOTICE = '口座番号は本人だけに表示します。銀行用 CSV（口座情報を含む）は、6桁コードかパスワードで本人確認したときだけ書き出せます（15分で期限切れ）。'

export function PaymentPagination({ total, page, pageSize, pageCount, onPageChange }: {
  total: number
  page: number
  pageSize: number
  pageCount: number
  onPageChange: (page: number) => void
}) {
  return <ListPagePagination>
    <Pagination page={page} pageCount={pageCount} onPageChange={onPageChange}
      range={{ total, first: total === 0 ? 0 : (page - 1) * pageSize + 1, last: Math.min(page * pageSize, total), unit: '人' }} />
  </ListPagePagination>
}
