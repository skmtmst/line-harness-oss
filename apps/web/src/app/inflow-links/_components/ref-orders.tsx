'use client'

/*
 * IDEA-18: 流入経路と注文の連結ブロック。
 *
 * `/api/analytics/ref/:refCode/orders` が返す注文明細を出す。
 * 集計（ref-summary の orderCount・この口の total）と明細は worker 側で
 * 同じ条件（その経路の ref を最初に持つ友だち＝first-touch 帰属、かつ
 * 見ている人が扱えるアカウント範囲）で数えているので、件数をそのまま
 * つき合わせられる。
 *
 * 未計測を0にしない:
 * - 読み込み中・取得失敗は「0件」とは別に言い分ける（ListState、再読み込み可）。
 * - 金額が取れていない注文は '—'。0円とは書かない。
 * - 友だちに結びついていない注文はここに出ない（= この経路の集計にも
 *   入らない）。その件数は一覧側の説明に出す。
 */

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchApi } from '@/lib/api'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import { TableHeadRow, Th } from '@/components/shared/table'

/** EC連携画面（order-detail-drawer）の状態文言とそろえる。 */
const ORDER_STATUS_TEXT: Record<string, string> = {
  current: '通常の注文',
  refunded: '返金済み',
  cancelled: '取り消し済み',
}

export interface RefOrderItem {
  id: string
  orderNumber: string
  status: string
  providerStatus: string
  currency: string
  totalAmount: number | null
  refundedAmount: number | null
  orderedAt: string
  detailUrl: string | null
  friend: { id: string; displayName: string | null }
}

interface RefOrdersResponse {
  refCode: string
  total: number
  summary: {
    refunded: number
    cancelled: number
    totalAmount: number | null
    refundedAmount: number | null
  }
  items: RefOrderItem[]
}

export interface RefOrdersResult {
  /** 明細の総件数。経路別集計の購入件数と同じ値になる。 */
  total: number
  refunded: number
  cancelled: number
  totalAmount: number | null
  refundedAmount: number | null
}

type LoadState = 'loading' | 'ready' | 'error'

function formatMoney(currency: string, amount: number | null): string {
  if (amount === null) return '—'
  return `${currency === 'JPY' ? '¥' : ''}${amount.toLocaleString('ja-JP')}`
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function RefOrdersPanel({
  refCode,
  accountId,
  pageSize = 10,
  /** 件数・返金/取消・金額の要約を親（KPIカード等）へ渡す。未取得は null。 */
  onSummaryChange,
}: {
  refCode: string
  accountId?: string | null
  pageSize?: number
  onSummaryChange?: (summary: RefOrdersResult | null) => void
}) {
  const [state, setState] = useState<LoadState>('loading')
  const [data, setData] = useState<RefOrdersResponse | null>(null)
  const [page, setPage] = useState(1)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setState('loading')
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String((page - 1) * pageSize),
    })
    if (accountId) params.set('lineAccountId', accountId)
    const res = await fetchApi<{ success: boolean; data: RefOrdersResponse | null }>(
      `/api/analytics/ref/${encodeURIComponent(refCode)}/orders?${params}`,
    ).catch(() => ({ success: false as const, data: null }))
    if (requestRef.current !== requestId) return
    if (res.success && res.data && Array.isArray(res.data.items)) {
      setData(res.data)
      setState('ready')
      onSummaryChange?.({
        total: res.data.total,
        refunded: res.data.summary?.refunded ?? 0,
        cancelled: res.data.summary?.cancelled ?? 0,
        totalAmount: res.data.summary?.totalAmount ?? null,
        refundedAmount: res.data.summary?.refundedAmount ?? null,
      })
    } else {
      setData(null)
      setState('error')
      onSummaryChange?.(null)
    }
  }, [refCode, accountId, page, pageSize, onSummaryChange])

  useEffect(() => {
    void load()
  }, [load])

  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div>
      <p className="text-xs font-semibold text-ink-faint uppercase">
        この経路からの注文{state === 'ready' ? `（全${total.toLocaleString('ja-JP')}件）` : ''}
      </p>
      {/*
        IDEA-18: 帰属ルールと計測できない範囲を明細のすぐそばで説明する。
        「ここに出ない注文がある」ことを先に伝え、未計測を0件の成果と
        読ませない。
      */}
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">
        この経路にはじめて来た友だちの注文だけを数えます（first-touch）。
        友だちと結びついていない注文や経路が分からない注文は計測できないため
        ここには出ません。同じ注文は二重には数えません。
      </p>
      {state === 'loading' ? (
        <ListState kind="loading" className="mt-2" />
      ) : state === 'error' ? (
        <ListState
          kind="error"
          className="mt-2"
          description="注文を読み込めませんでした。再読み込みしてください。"
          onRetry={() => void load()}
        />
      ) : total === 0 ? (
        <ListState
          kind="empty"
          emptyPreset="readonly"
          className="mt-2"
          title="計測できる注文はまだありません"
          description="この経路から来た友だちの注文が記録されると、ここに表示されます。"
        />
      ) : (
        <div className="mt-2 overflow-hidden rounded-lg border border-hairline bg-canvas">
          <table className="w-full text-xs">
            <thead className="border-b border-hairline bg-canvas-sunken text-ink-faint">
              <TableHeadRow>
                <Th>注文番号</Th>
                <Th>お客様</Th>
                <Th>状態</Th>
                <Th align="right">金額</Th>
                <Th>注文日</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-y divide-hairline">
              {(data?.items ?? []).map((order) => (
                <tr key={order.id}>
                  <td className="px-3 py-2 font-mono text-ink" title={order.orderNumber}>
                    <span className="block truncate whitespace-nowrap">{order.orderNumber}</span>
                  </td>
                  <td className="px-3 py-2 text-ink-secondary">
                    <Link
                      href={`/friends/detail?id=${encodeURIComponent(order.friend.id)}`}
                      className="text-action hover:underline"
                    >
                      {order.friend.displayName ?? '名前なし'}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink-secondary">
                    {ORDER_STATUS_TEXT[order.status] ?? order.status}
                    {order.status === 'refunded' && order.refundedAmount !== null
                      ? `（−${formatMoney(order.currency, order.refundedAmount)}）`
                      : ''}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {formatMoney(order.currency, order.totalAmount)}
                  </td>
                  <td className="px-3 py-2 text-ink-faint">{formatDate(order.orderedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pageCount > 1 ? (
            <div className="flex items-center justify-end border-t border-hairline px-3 py-2">
              <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
