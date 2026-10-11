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
import DateField from '@/components/shared/date-field'
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
    <div className={`${styles.filterRow} ${styles.filterRowOneLine}`}>
      <DateField
        aria-label="日付"
        size="compact"
        className={styles.filterDate}
        value={date}
        onChange={onDateChange}
      />
      {/*
        * 絵（OzHLO）のサービスの箱は先頭に漏斗の印がある（箱 x1085 幅195・余白12・印15 →
        * 文字 x1120）。印が無いと文字が x1098 に寄って絵と22ずれる。画面CSSで足さず、
        * 共通の箱が持つ `icon` へ渡す（★V8 §24 部品の見た目は部品側で決める）。
        * さらに決まった幅の箱は値が両端に釣り合って真ん中へ浮くので、`valueAlign="start"` で
        * 絵と同じ「印のすぐ右から文字」にする（余白12＋印16＋間6＝x1120）。
        */}
      <Select
        aria-label="サービス"
        icon={<Funnel size={15} aria-hidden="true" />}
        valueAlign="start"
        className={styles.filterService}
        value={service}
        onChange={(value) => {
          const next = DELIVERY_SERVICES.find((item) => item === value)
          onServiceChange(next ?? '')
        }}
        options={SERVICE_OPTIONS}
      />
      {/*
        * 絵（OzHLO）の「CSVで保存」は幅112（余白14・印15・間6）。共通の既定（余白16・印13）
        * だと131になり、左の絞り込み2つを19ずつ押し出してしまう。板の頭の操作は
        * `size="delivery-head"`（絵 kDQHr と同じ値）で絵へ合わせる。
        * また「保存しました」は出さないので、結果の文字の分の幅を控えない（widthReserve="idle"）。
        */}
      <Button
        size="delivery-head"
        widthReserve="idle"
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
      <Td>
        <span className={styles.elapsed}>{formatClock(order.receivedAt)}</span>
      </Td>
      <Td>
        {/* 絵（OzHLO）の注文内容は1行だけ。点数は注文の詳細（hjdqV）で出す。 */}
        <span className={styles.items} title={order.itemSummary || undefined}>
          {order.itemSummary || DASH}
        </span>
      </Td>
      <Td align="right">
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
          {/* 絵（`ZuE0v`）は枠付きの別々の札4枚。大きい値は売上金額で、件数は題の右に小さく出す。 */}
          <div className={styles.sumRow} data-design="ZuE0v">
            <div className={styles.sumCard}>
              <div className={styles.sumHead}>
                <span className={styles.sumTitle}>{isToday ? '本日の合計' : '合計'}</span>
                {/* 絵（ZuE0v）の札に細い横線は無いので、線は置かず件数を右端へ寄せるだけにする。 */}
                <span className={styles.sumCount} title={countNote}>
                  {totals ? `${totals.count}件` : DASH}
                </span>
              </div>
              <p className={styles.sumAmount}>{formatYen(totals ? totals.amount : null)}</p>
            </div>
            {byService.map((row) => (
              <div key={row.service} className={styles.sumCard}>
                <div className={styles.sumHead}>
                  <StatusBadge tone={SERVICE_TONES[row.service]} size="compact" dot={false}>{row.label}</StatusBadge>
                  <span className={styles.sumCount}>{row.count}件</span>
                </div>
                <p className={styles.sumAmount}>{formatYen(row.amount)}</p>
              </div>
            ))}
          </div>

          <DataTable className={styles.table} data-design="OzHLO" presentation="delivery" label="デリバリーの注文履歴"><thead>
            <TableHeadRow>
              <Th className={styles.th}>注文番号</Th>
              <Th className={styles.th}>サービス</Th>
              <Th className={styles.th}>時刻</Th>
              <Th className={styles.th}>注文内容</Th>
              {/* 絵（OzHLO）の見出しは全部左。中の金額だけ右に寄せる。 */}
              <Th className={styles.th}>金額</Th>
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
