'use client'

/*
 * ★V8 デリバリー受注・注文履歴と売上（板 `OzHLO`）。
 *
 * 絵のとおり「日付」「サービス」の2つだけで絞る（状態の絞り込みは絵に無いので置かない）。
 * 絞り込みと「CSVで保存」は板の頭の右（親が RestaurantPage の picker に置く）。
 * 数の帯は4枚（合計＋サービス3つ）。件数と売上はキャンセル・拒否を除いた数なので、
 * 足もとの「N件中」（キャンセルも含む行数）と食い違う。そのずれは合計の札に文字で書く。
 * 取れない値は数を作らず「—」を出す（D024）。
 */

import { Download } from 'lucide-react'
import Button from '@/components/shared/button'
import DateField from '@/components/shared/date-field'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { DataTable, TableHeadRow, TableStateRow, Td, Th, Tr } from '@/components/shared/table'
import {
  DELIVERY_SERVICES,
  DELIVERY_SERVICE_LABELS,
  type DeliveryHistoryData,
  type DeliveryHistoryOrder,
  type DeliveryOrderStatus,
  type DeliveryService,
} from '@/lib/restaurant-delivery-api'
import { CANCEL_REASON_LABELS, DASH, formatClock, formatYen } from './format'
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

function countText(value: number | null | undefined, unit = '件') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DASH
  return `${value}${unit}`
}

/* ── 板の頭の右（日付・サービス・CSV） ───────────────────────────── */

export interface HistoryHeaderActionsProps {
  /** `YYYY-MM-DD`。 */
  date: string
  service: DeliveryService | ''
  csvBusy: boolean
  /** 1件も無いときは保存するものが無いので押せない。 */
  csvDisabled: boolean
  onDateChange: (value: string) => void
  onServiceChange: (value: DeliveryService | '') => void
  onCsv: () => void
}

/** 板の頭の右。親が RestaurantPage の picker へ置く。 */
export function HistoryHeaderActions({
  date,
  service,
  csvBusy,
  csvDisabled,
  onDateChange,
  onServiceChange,
  onCsv,
}: HistoryHeaderActionsProps) {
  return (
    <div className={styles.filterRow}>
      <DateField
        aria-label="日付"
        size="compact"
        value={date}
        onChange={onDateChange}
      />
      <Select
        aria-label="サービス"
        value={service}
        onChange={(value) => {
          const next = DELIVERY_SERVICES.find((item) => item === value)
          onServiceChange(next ?? '')
        }}
        options={SERVICE_OPTIONS}
      />
      <Button
        onClick={onCsv}
        busy={csvBusy}
        busyLabel="保存中…"
        disabled={csvDisabled}
      >
        <Download size={15} aria-hidden="true" />CSVで保存
      </Button>
    </div>
  )
}

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
    <Tr>
      <Td className={styles.td}>
        <Button
          variant="text"
          size="inline"
          aria-label={`注文${order.orderNumber}の詳細`}
          onClick={() => onOpenOrder(order.id)}
        >
          <span className={styles.orderNumber}>{order.orderNumber || DASH}</span>
        </Button>
      </Td>
      <Td className={styles.td}>
        <StatusBadge tone="neutral" size="compact">
          {order.serviceLabel || DELIVERY_SERVICE_LABELS[order.service]}
        </StatusBadge>
      </Td>
      <Td className={styles.td}>
        <span className={styles.elapsed}>{formatClock(order.receivedAt)}</span>
      </Td>
      <Td className={styles.td}>
        <span className={styles.items} title={order.itemSummary || undefined}>
          {order.itemSummary || DASH}
        </span>
        <span className={styles.itemNote}>{countText(order.itemCount, '点')}</span>
      </Td>
      <Td className={styles.td} align="right">
        <span className={styles.amount}>{formatYen(order.totalAmount)}</span>
      </Td>
      <Td className={styles.td}>
        <div className={styles.urgencyCell}>
          <StatusBadge tone={STATUS_TONES[order.status]} size="compact">
            {order.statusLabel || DASH}
          </StatusBadge>
          {reason ? <span className={styles.urgencyReason}>{reason}</span> : null}
        </div>
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
  shown: number
  /** 上限で切れたときの案内。切れていないときは null。 */
  csvNote: string | null
  onOpenOrder: (id: string) => void
  onRetry: () => void
  onShowMore: () => void
}

export default function HistoryBoard({
  data,
  loading,
  error,
  isToday,
  shown,
  csvNote,
  onOpenOrder,
  onRetry,
  onShowMore,
}: HistoryBoardProps) {
  const orders = data?.orders ?? []
  const visible = orders.slice(0, shown)
  const totals = data?.totals ?? null
  const prefix = isToday ? '本日 ' : ''
  const canceled = totals ? totals.canceledCount : null
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
      {csvNote ? <p className={styles.muted}>{csvNote}</p> : null}

      {loading && !data ? (
        <div className={styles.stateBox}>
          <ListState kind="loading" title="注文履歴を読み込んでいます" />
        </div>
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
          <KpiBand presentation="separated" gridClassName="">
            <KpiCard
              presentation="cell"
              title={isToday ? '本日の合計' : '合計'}
              value={totals ? totals.count : null}
              unit="件"
              detail={formatYen(totals ? totals.amount : null)}
              description={
                typeof canceled === 'number' && Number.isFinite(canceled)
                  ? `キャンセル・拒否を除く（キャンセル ${canceled}件）`
                  : 'キャンセル・拒否を除く'
              }
            />
            {byService.map((row) => (
              <KpiCard
                key={row.service}
                presentation="cell"
                title={row.label}
                value={row.count}
                unit="件"
                detail={formatYen(row.amount)}
              />
            ))}
          </KpiBand>

          <DataTable className={styles.table} data-design="OzHLO" label="デリバリーの注文履歴"><thead>
            <TableHeadRow>
              <Th className={styles.th}>注文番号</Th>
              <Th className={styles.th}>サービス</Th>
              <Th className={styles.th}>時刻</Th>
              <Th className={styles.th}>注文内容</Th>
              <Th className={styles.th} align="right">金額</Th>
              <Th className={styles.th}>状態</Th>
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
          </tbody></DataTable>

          {orders.length > 0 ? (
            <div className={styles.tableFoot}>
              <p className={styles.muted}>
                {prefix}{orders.length}件中 1〜{visible.length}件を表示
              </p>
              {visible.length < orders.length ? (
                <Button variant="text" size="compact" onClick={onShowMore}>さらに表示</Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </>
  )
}
