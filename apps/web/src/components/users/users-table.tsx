'use client'

import UserRow, { type UserRowData } from './user-row'
import Pagination from '@/components/shared/pagination'
import { TableHeadRow, Th } from '@/components/shared/table'
import { TableStateRow } from '@/components/shared/table'

const fmt = new Intl.NumberFormat('ja-JP')

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
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  const countAvailable = !loading && !error

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-card">
      <table className="w-full table-fixed">
        {/*
          列幅の決め方（1440pxで操作ボタンが枠をはみ出していたため固定化）。
          連絡先・紐付くアカウントだけが伸び縮みし、他は固定。
          操作列 176px の根拠：詳細ボタン 98px（「詳細を見る」5字×14px＋左右13px＋枠2px）
          ＋隙間 8px＋「…」32px＋セル余白 24px＝162px。閉じたメニューは描かれない。
        */}
        <colgroup>
          <col className="w-[16%]" />
          <col />
          <col />
          <col className="w-[108px]" />
          <col className="w-[108px]" />
          <col className="w-[92px]" />
          <col className="w-[176px]" />
        </colgroup>
        <thead className="border-b border-hairline bg-canvas-sunken text-left text-micro font-semibold text-ink-secondary">
          <TableHeadRow>
            {/*
              表の外側の余白は左右で同じにする（左端 pl-5・右端 pr-5）。
              操作列の右だけ狭いとボタンが枠にくっついて見える。
            */}
            <Th className="pl-5">統合ユーザー</Th>
            <Th>連絡先</Th>
            <Th>紐付くアカウント</Th>
            <Th>UID</Th>
            <Th>最終接触</Th>
            <Th>重複配信</Th>
            <Th align="right" className="pr-5">操作</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            loading ? (
              <TableStateRow colSpan={7} kind="loading" />
            ) : error ? (
              <TableStateRow
                colSpan={7}
                kind="error"
                title="統合ユーザーを表示できませんでした"
                description="再計算するか、時間をおいてもう一度お試しください。"
                onRetry={onRetry}
              />
            ) : (
              <TableStateRow
                colSpan={7}
                kind="empty"
                title="条件に合う統合ユーザーがいません"
                description="検索条件を変えてお試しください。"
              />
            )
          ) : (
            rows.map((row) => (
              <UserRow
                key={row.identityKey}
                row={row}
                onOpenMergedPerson={onOpenMergedPerson}
              />
            ))
          )}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-divider-soft px-4 py-3 text-sm text-ink-secondary">
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
