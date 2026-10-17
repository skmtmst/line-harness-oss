'use client'

/*
 * ★V8 デリバリー受注・注文履歴と売上（板 `OzHLO`）。
 *
 * 絵のとおり「日付」「サービス」の2つだけで絞る（状態の絞り込みは絵に無いので置かない）。
 * 絞り込みと「CSVで保存」は板の頭の右（親が RestaurantPage の picker に置く）。絵は1行なので
 * 折り返さない幅で置く（折り返すと板の頭が伸びて下の集計・表がまるごとずれる）。
 * 集計の帯は枠付きの札4枚（合計＋サービス3つ）。絵の大きい値は売上金額で、件数は題の右に小さく出す。
 * 件数と売上はキャンセル・拒否を除いた数なので、足もとの「N件中」（キャンセルも含む行数）と
 * 食い違う。そのずれは件数に指を当てたときだけ文字で出す（絵に3行目が無いため）。
 * 取れない値は数を作らず「—」を出す（D024）。
 */

import { Download, Funnel } from 'lucide-react'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import DateField from '@/components/shared/date-field'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import ListToolbar from '@/components/shared/list-toolbar'
import Pagination, { paginationSummary } from '@/components/shared/pagination'
import PageSizeSelect from '@/components/shared/page-size-select'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { DataTable, TableHeadRow, TableStateRow, Td, Th, Tr } from '@/components/shared/table'
import TruncatedText from '@/components/shared/truncated-text'
import {
  DELIVERY_SERVICES,
  DELIVERY_SERVICE_LABELS,
  type DeliveryHistoryData,
  type DeliveryHistoryOrder,
  type DeliveryOrderStatus,
  type DeliveryService,
} from '@/lib/restaurant-delivery-api'
import {
  CANCEL_REASON_LABELS,
  DASH,
  SERVICE_TONES,
  formatClock,
  formatOrderNumber,
  formatYen,
} from './format'
import styles from './delivery.module.css'

const STATUS_TONES: Record<DeliveryOrderStatus, StatusBadgeTone> = {
  new: 'info',
  cooking: 'warning',
  ready: 'success',
  handed_over: 'success',
  canceled: 'neutral',
  rejected: 'neutral',
}

const COLUMN_COUNT = 6

const SERVICE_OPTIONS = [
  { value: '', label: 'すべてのサービス' },
  ...DELIVERY_SERVICES.map((service) => ({
    value: service,
    label: DELIVERY_SERVICE_LABELS[service],
  })),
]

/* ── 表の行 ───────────────────────────────────────────────── */

function HistoryRow({
  order,
  onOpenOrder,
}: {
  order: DeliveryHistoryOrder
  onOpenOrder: (id: string) => void
}) {
  const reason = order.cancelReasonCode ? CANCEL_REASON_LABELS[order.cancelReasonCode] : null
  return (
    <Tr data-table-layout="columns">
      <Td>
        <Button
          variant="text"
          size="inline"
          aria-label={`注文${order.orderNumber}の詳細`}
          onClick={() => onOpenOrder(order.id)}
        >
          <span className={styles.orderNumber}>{formatOrderNumber(order.orderNumber)}</span>
        </Button>
      </Td>
      <Td>
        {/* 絵のサービス札（OzHLO）は点なし。状態札だけが点を持つ。 */}
        <StatusBadge tone={SERVICE_TONES[order.service]} size="compact" dot={false}>
          {order.serviceLabel || DELIVERY_SERVICE_LABELS[order.service]}
        </StatusBadge>
      </Td>
      <Td data-list-number>
        <span className={styles.elapsed}>{formatClock(order.receivedAt)}</span>
      </Td>
      <Td grow>
        {/* 注文内容は1行だけ。点数は注文の詳細（hjdqV）で出す。 */}
        <TruncatedText value={order.itemSummary || DASH} />
      </Td>
      <Td align="right" data-list-number>
        <span className={styles.amount}>{formatYen(order.totalAmount)}</span>
      </Td>
      <Td>
        {/* 絵（OzHLO）の「状態」は札だけ。キャンセルの理由は札の下に書かず、指を当てたときだけ出す。 */}
        <span className={styles.urgencyCell} title={reason || undefined}>
          <StatusBadge tone={STATUS_TONES[order.status]} size="delivery">
            {order.statusLabel || DASH}
          </StatusBadge>
        </span>
      </Td>
    </Tr>
  )
}

/* ── D-4 `OzHLO` 注文履歴・売上 ────────────────────────────────── */

export interface HistoryBoardProps {
  data: DeliveryHistoryData | null
  loading: boolean
  /** 日本語の案内だけを入れる。 */
  error: string | null
  /** きょうを選んでいるか（足もとの「本日」の出し分け）。 */
  isToday: boolean
  page: number
  perPage: number
  /** 上限で切れたときの案内。切れていないときは null。 */
  csvNote: string | null
  onOpenOrder: (id: string) => void
  onRetry: () => void
  onPage: (page: number) => void
  onPerPage: (perPage: number) => void
  /** 日付・サービス・CSV は道具の段（ListToolbar）に置く。 */
  date: string
  service: DeliveryService | ''
  csvBusy: boolean
  /** 1件も無いときは保存するものが無いので押せない。 */
  csvDisabled: boolean
  onDateChange: (value: string) => void
  onServiceChange: (value: DeliveryService | '') => void
  onCsv: () => void
}

export default function HistoryBoard({
  data,
  loading,
  error,
  isToday,
  page,
  perPage,
  csvNote,
  onOpenOrder,
  onRetry,
  onPage,
  onPerPage,
  date,
  service,
  csvBusy,
  csvDisabled,
  onDateChange,
  onServiceChange,
  onCsv,
}: HistoryBoardProps) {
  const orders = data?.orders ?? []
  const pageCount = Math.max(1, Math.ceil(orders.length / perPage))
  const currentPage = Math.min(page, pageCount)
  const firstIndex = (currentPage - 1) * perPage
  const visible = orders.slice(firstIndex, firstIndex + perPage)
  const totals = data?.totals ?? null
  const prefix = isToday ? '本日 ' : ''
  const canceled = totals ? totals.canceledCount : null
  /* 絵に3行目が無いので、キャンセルを除いた数であることは件数に指を当てたときだけ出す。 */
  const countNote = typeof canceled === 'number' && Number.isFinite(canceled)
    ? `キャンセル・拒否を除く（キャンセル ${canceled}件）`
    : 'キャンセル・拒否を除く'
  /* サービスの札は絵のとおり3つとも出す。その日に注文が無かったサービスは0件になる。 */
  const byService = DELIVERY_SERVICES.map((service) => {
    const row = totals?.byService.find((item) => item.service === service)
    return {
      service,
      label: row?.label || DELIVERY_SERVICE_LABELS[service],
      count: row ? row.count : 0,
      amount: row ? row.amount : 0,
    }
  })

  return (
    <>
      <ListToolbar
        filters={(
          <>
            {/* 日付は共通の日付の欄。狭い幅でも切れないよう月日の書き方（10/01）で出す。 */}
            <span className={styles.filterDate}>
              <DateField aria-label="日付" displayFormat="short" value={date} onChange={onDateChange} />
            </span>
            <Select
              aria-label="サービス"
              icon={<Funnel size={16} aria-hidden="true" />}
              value={service}
              onChange={(value) => {
                const next = DELIVERY_SERVICES.find((item) => item === value)
                onServiceChange(next ?? '')
              }}
              options={SERVICE_OPTIONS}
            />
          </>
        )}
        trailing={(
          <>
            <Button onClick={onCsv} busy={csvBusy} busyLabel="書き出し中…" disabled={csvDisabled}>
              <Download size={16} aria-hidden="true" />CSVで書き出す
            </Button>
            <PageSizeSelect value={perPage} onChange={onPerPage} />
          </>
        )}
      />
      {csvNote ? <p className={styles.muted}>{csvNote}</p> : null}

      {loading && !data ? (
        <ListState kind="loading" title="注文履歴を読み込んでいます" />
      ) : null}
      {error && !data ? (
        <ListState
          kind="error"
          title="注文履歴を表示できませんでした"
          description={error}
          onRetry={onRetry}
        />
      ) : null}

      {data ? (
        <>
          {/* 売上の4つの数は、線で区切った1本の帯（共通の KpiBand）。合計＋サービス3つ。 */}
          <KpiBand data-design="ZuE0v" aria-label="売上の集計">
            <KpiCard
              title={isToday ? '本日の合計' : '合計'}
              icon={null}
              value={null}
              unit=""
              valueText={formatYen(totals ? totals.amount : null)}
              detail={<span title={countNote}>{totals ? `${totals.count}件` : DASH}</span>}
            />
            {byService.map((row) => (
              <KpiCard
                key={row.service}
                title={row.label}
                icon={null}
                value={null}
                unit=""
                valueText={formatYen(row.amount)}
                detail={`${row.count}件`}
              />
            ))}
          </KpiBand>

          <Card overflow="hidden"><DataTable density="reviews" columnSizing="content" data-design="OzHLO" label="デリバリーの注文履歴"><thead>
            <TableHeadRow data-table-layout="columns">
              <Th>注文番号</Th>
              <Th>サービス</Th>
              <Th>時刻</Th>
              <Th grow>注文内容</Th>
              <Th align="right">金額</Th>
              <Th>状態</Th>
            </TableHeadRow></thead><tbody>
            {visible.length === 0 ? (
              <TableStateRow
                colSpan={COLUMN_COUNT}
                kind={error ? 'error' : loading ? 'loading' : 'empty'}
                title={error ? '注文履歴を表示できませんでした' : undefined}
                description={error ?? undefined}
                {...(error ? { onRetry } : {})}
              />
            ) : (
              visible.map((order) => (
                <HistoryRow key={order.id} order={order} onOpenOrder={onOpenOrder} />
              ))
            )}
          </tbody></DataTable></Card>

          {orders.length > 0 ? (
            <>
              <Pagination
                page={currentPage}
                pageCount={pageCount}
                onPageChange={onPage}
                summary={`${prefix}${paginationSummary(orders.length, firstIndex + 1, firstIndex + visible.length)}`}
              />
            </>
          ) : null}
        </>
      ) : null}
    </>
  )
}
