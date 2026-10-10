'use client'

/*
 * ★V8 デリバリー受注・注文一覧（板 `kDQHr`）。
 *
 * 画面は受け取った数と状態を出すだけにする。送信・状態の進みは親（delivery.tsx）が持つ。
 * 急ぎ度の判定はWorker側だけで行い、ここには結果と理由の文しか来ない（仕組みの名前は出さない）。
 */

import { useState } from 'react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import { RowMenu } from '@/components/shared/row-actions'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { DataTable, TableHeadRow, TableStateRow, Td, Th, Tr } from '@/components/shared/table'
import { Tabs, type TabItem } from '@/components/shared/tabs'
import {
  DELIVERY_SERVICE_LABELS,
  type DeliveryConnectionStatus,
  type DeliveryIntakeStatus,
  type DeliveryOrderStatus,
  type DeliveryOrderSummary,
  type DeliveryOrderTab,
  type DeliveryOrdersData,
  type DeliveryService,
  type DeliveryServiceState,
  type DeliveryUrgency,
} from '@/lib/restaurant-delivery-api'
import {
  DASH,
  SERVICE_TONES,
  formatClock,
  formatElapsed,
  formatOrderNumber,
  formatYen,
  urgencyLabel,
} from './format'
import styles from './delivery.module.css'

const CONNECTION_LABELS: Record<DeliveryConnectionStatus, string> = {
  connected: '接続中',
  disconnected: '未接続',
  error: '接続エラー',
}

const CONNECTION_TONES: Record<DeliveryConnectionStatus, StatusBadgeTone> = {
  connected: 'success',
  disconnected: 'neutral',
  error: 'danger',
}

const INTAKE_LABELS: Record<DeliveryIntakeStatus, string> = { open: '受付中', stopped: '停止中' }
const INTAKE_TONES: Record<DeliveryIntakeStatus, StatusBadgeTone> = { open: 'success', stopped: 'warning' }

/* キャンセル・拒否は色で責めない（起きたことを文字で伝えるだけ）。 */
const STATUS_TONES: Record<DeliveryOrderStatus, StatusBadgeTone> = {
  new: 'info',
  cooking: 'warning',
  ready: 'success',
  handed_over: 'success',
  canceled: 'neutral',
  rejected: 'neutral',
}

const URGENCY_TONES: Record<DeliveryUrgency, StatusBadgeTone> = {
  urgent: 'danger',
  watch: 'warning',
  normal: 'neutral',
}

const TAB_LABELS: Record<DeliveryOrderTab, string> = {
  new: '新着',
  cooking: '調理中',
  handed_over: '受け渡し済み',
  all: 'すべて',
}

const TAB_ORDER: DeliveryOrderTab[] = ['new', 'cooking', 'handed_over', 'all']

/** 表の列数（選ぶ・注文番号・サービス・注文内容・金額・経過・急ぎ度・状態・操作）。 */
const COLUMN_COUNT = 9

/** 数を推測しない。取れないときは「—」にする（D021/D024）。0 は 0 のまま出す。 */
function countText(value: number | null | undefined, unit = '件'): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}${unit}` : DASH
}

/** 増減の札。取れないときは札を出さない。 */
function signedCount(value: number | null | undefined, unit: string): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value === 0) return `±0${unit}`
  return `${value > 0 ? '+' : '-'}${Math.abs(value)}${unit}`
}

function signedPercent(value: number | null | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value === 0) return '±0%'
  return `${value > 0 ? '+' : '-'}${Math.abs(value)}%`
}

function ServiceCard({
  state,
  canManage,
  busy,
  onStop,
  onResume,
}: {
  state: DeliveryServiceState
  canManage: boolean
  busy: boolean
  onStop: (service: DeliveryService) => void
  onResume: (service: DeliveryService) => void
}) {
  const label = state.label || DELIVERY_SERVICE_LABELS[state.service]
  const stopped = state.intakeStatus === 'stopped'
  return (
    <div className={styles.serviceCard}>
      <div className={styles.serviceHead}>
        <span className={styles.serviceName}>{label}</span>
        <StatusBadge tone={CONNECTION_TONES[state.connectionStatus]} size="compact">
          {CONNECTION_LABELS[state.connectionStatus]}
        </StatusBadge>
        <StatusBadge tone={INTAKE_TONES[state.intakeStatus]} size="compact">
          {INTAKE_LABELS[state.intakeStatus]}
        </StatusBadge>
      </div>
      <div className={styles.serviceBody}>
        <span className={styles.serviceCount}>{countText(state.todayCount)}</span>
        <span className={styles.spacer} />
        {canManage ? (
          stopped ? (
            <Button
              size="compact"
              busy={busy}
              busyLabel="再開中…"
              aria-label={`${label}の受付を再開`}
              onClick={() => onResume(state.service)}
            >
              再開
            </Button>
          ) : (
            <Button
              size="compact"
              aria-label={`${label}の受付を停止`}
              onClick={() => onStop(state.service)}
            >
              停止
            </Button>
          )
        ) : null}
      </div>
      {stopped && state.stopUntil ? (
        <p className={styles.muted}>{formatClock(state.stopUntil)} まで停止</p>
      ) : null}
    </div>
  )
}

function OrderRow({
  order,
  nowMs,
  busy,
  canManage,
  checked,
  selectable,
  onToggleSelect,
  onOpen,
  onAccept,
  onReject,
  onReady,
}: {
  order: DeliveryOrderSummary
  nowMs: number
  busy: boolean
  canManage: boolean
  /** まとめて受け付ける相手として選んでいるか。 */
  checked: boolean
  /** 新着だけ選べる（受け付けたあとの注文はまとめて受け付けられない）。 */
  selectable: boolean
  onToggleSelect: (id: string, checked: boolean) => void
  onOpen: (id: string) => void
  onAccept: (order: DeliveryOrderSummary) => void
  onReject: (order: DeliveryOrderSummary) => void
  onReady: (order: DeliveryOrderSummary) => void
}) {
  return (
    <Tr density="comfortable">
      <Td className={styles.td}>
        <Checkbox
          aria-label={`注文${order.orderNumber}を選ぶ`}
          checked={checked}
          disabled={!selectable || busy}
          onCheckedChange={(next) => onToggleSelect(order.id, next)}
        />
      </Td>
      <Td className={styles.td}>
        <Button
          variant="text"
          size="inline"
          className={styles.orderNumber}
          aria-label={`注文${order.orderNumber}の詳細`}
          onClick={() => onOpen(order.id)}
        >
          {formatOrderNumber(order.orderNumber)}
        </Button>
      </Td>
      <Td className={styles.td}>
        <StatusBadge tone={SERVICE_TONES[order.service]} size="compact">
          {order.serviceLabel || DELIVERY_SERVICE_LABELS[order.service]}
        </StatusBadge>
      </Td>
      <Td className={styles.td}>
        <span className={styles.items} title={order.itemSummary}>
          {order.itemSummary || DASH}
        </span>
      </Td>
      <Td align="right" className={styles.td}>
        <span className={styles.amount}>{formatYen(order.totalAmount)}</span>
      </Td>
      <Td align="right" className={styles.td}>
        <span className={styles.elapsed}>{formatElapsed(order.receivedAt, nowMs)}</span>
      </Td>
      <Td className={styles.td}>
        {/* 絵（kDQHr）の一覧は印だけ。理由の文は幅を押し広げるので注文の詳細（hjdqV）で出す。 */}
        <span className={styles.urgencyCell} title={order.urgencyReason || undefined}>
          <StatusBadge tone={URGENCY_TONES[order.urgency]} size="compact">
            {urgencyLabel(order.urgency)}
          </StatusBadge>
        </span>
      </Td>
      <Td className={styles.td}>
        <StatusBadge tone={STATUS_TONES[order.status]} size="compact">
          {order.statusLabel || DASH}
        </StatusBadge>
      </Td>
      <Td align="right" className={styles.td}>
        <span className={styles.rowActions}>
          {order.status === 'new' && canManage ? (
            <>
              <Button
                variant="primary"
                size="compact"
                busy={busy}
                busyLabel="受付中…"
                aria-label={`注文${order.orderNumber}を受け付ける`}
                onClick={() => onAccept(order)}
              >
                受け付ける
              </Button>
              <Button
                size="compact"
                aria-label={`注文${order.orderNumber}を拒否`}
                onClick={() => onReject(order)}
              >
                拒否
              </Button>
            </>
          ) : order.status === 'cooking' && canManage ? (
            <Button
              variant="primary"
              size="compact"
              busy={busy}
              busyLabel="変更中…"
              aria-label={`注文${order.orderNumber}を準備完了にする`}
              onClick={() => onReady(order)}
            >
              準備完了
            </Button>
          ) : (
            <Button
              size="compact"
              aria-label={`注文${order.orderNumber}を開く`}
              onClick={() => onOpen(order.id)}
            >
              詳細
            </Button>
          )}
        </span>
      </Td>
    </Tr>
  )
}

/**
 * 数の帯の「…」（kDQHr）。この画面から行ける先だけを出す。
 * いまはどの数も「今日の数」なので、行き先は注文履歴・売上（OzHLO）の1つ。
 */
function KpiMenu({ title, onOpenHistory }: { title: string; onOpenHistory: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <span className={styles.kpiMenu}>
      <RowMenu
        className={styles.kpiMenuButton}
        label={`${title}の操作`}
        open={open}
        onOpenChange={setOpen}
        items={[
          {
            id: 'history',
            label: '注文履歴・売上を開く',
            onSelect: () => {
              setOpen(false)
              onOpenHistory()
            },
          },
        ]}
      />
    </span>
  )
}

export interface OrdersBoardProps {
  data: DeliveryOrdersData
  /** いま表から見せている件数（「さらに表示」で増える）。 */
  shown: number
  /** 送信中の注文（二重送信を防ぐため、その行のボタンだけ回す）。 */
  busyOrderId: string | null
  /** 受付の再開を送っているサービス。 */
  busyService: DeliveryService | null
  canManage: boolean
  nowMs: number
  /** まとめて受け付ける相手として選んでいる注文の id。 */
  selected: string[]
  /** まとめて受け付けている間。 */
  bulkBusy: boolean
  onToggleSelect: (id: string, checked: boolean) => void
  onToggleSelectAll: (checked: boolean) => void
  /** 選んだ新着注文をまとめて受け付ける。 */
  onBulkAccept: () => void
  onTab: (tab: DeliveryOrderTab) => void
  /** 数の帯の「…」から注文履歴・売上（OzHLO）へ移る。 */
  onOpenHistory: () => void
  onOpenOrder: (id: string) => void
  onAccept: (order: DeliveryOrderSummary) => void
  onReject: (order: DeliveryOrderSummary) => void
  onReady: (order: DeliveryOrderSummary) => void
  onStopService: (service: DeliveryService) => void
  onResumeService: (service: DeliveryService) => void
  onShowMore: () => void
}

export default function OrdersBoard({
  data,
  shown,
  busyOrderId,
  busyService,
  canManage,
  nowMs,
  selected,
  bulkBusy,
  onToggleSelect,
  onToggleSelectAll,
  onBulkAccept,
  onTab,
  onOpenHistory,
  onOpenOrder,
  onAccept,
  onReject,
  onReady,
  onStopService,
  onResumeService,
  onShowMore,
}: OrdersBoardProps) {
  const kpis = data.kpis
  const total = data.tabCounts[data.tab]
  const visible = data.orders.slice(0, shown)
  /*
   * 「まとめて受け付ける」は新着だけを相手にする。
   * まとめ送りの口はWorkerに無いので、親が1件ずつ順に送る（絵の操作は変えない）。
   */
  const selectedSet = new Set(selected)
  const selectableIds = visible.filter((order) => order.status === 'new').map((order) => order.id)
  const checkedCount = selectableIds.filter((id) => selectedSet.has(id)).length
  const allChecked = selectableIds.length > 0 && checkedCount === selectableIds.length
  const someChecked = checkedCount > 0 && !allChecked
  const tabs: TabItem[] = TAB_ORDER.map((tab) => ({
    id: `delivery-tab-${tab}`,
    label: TAB_LABELS[tab],
    count: data.tabCounts[tab],
    countTone: tab === 'new' && data.tabCounts.new > 0 ? ('warning' as const) : undefined,
    current: data.tab === tab,
    onClick: () => onTab(tab),
  }))

  return (
    <>
      <div className={styles.serviceRow}>
        {data.services.map((state) => (
          <ServiceCard
            key={state.service}
            state={state}
            canManage={canManage}
            busy={busyService === state.service}
            onStop={onStopService}
            onResume={onResumeService}
          />
        ))}
      </div>

      <KpiBand gridClassName="">
        <KpiCard
          presentation="cell"
          title="本日の注文"
          value={kpis.todayCount}
          unit="件"
          delta={signedCount(kpis.todayCountDelta, '件')}
          detail={`受け渡し済み ${countText(kpis.handedOverCount)}`}
          menu={<KpiMenu title="本日の注文" onOpenHistory={onOpenHistory} />}
        />
        <KpiCard
          presentation="cell"
          title="本日の売上"
          value={kpis.todaySales}
          unit=""
          valueText={formatYen(kpis.todaySales)}
          delta={signedPercent(kpis.todaySalesDeltaPercent)}
          detail={`平均単価 ${formatYen(kpis.averageAmount)}`}
          menu={<KpiMenu title="本日の売上" onOpenHistory={onOpenHistory} />}
        />
        <KpiCard
          presentation="cell"
          title="急ぎ対応"
          value={kpis.urgentCount}
          unit="件"
          delta={kpis.urgentCount > 0 ? '要対応' : undefined}
          detail="待ち時間と注文内容から自動判定"
          menu={<KpiMenu title="急ぎ対応" onOpenHistory={onOpenHistory} />}
        />
        <KpiCard
          presentation="cell"
          title="平均準備時間"
          value={kpis.averagePrepMinutes}
          unit="分"
          delta={signedCount(kpis.averagePrepMinutesDelta, '分')}
          detail="目標 15分以内"
          menu={<KpiMenu title="平均準備時間" onOpenHistory={onOpenHistory} />}
        />
      </KpiBand>

      {/* 絵（kDQHr）の並びは サービス3枚 → 数の帯 → タブ → 表。 */}
      <Tabs items={tabs} label="注文の状態" />

      {checkedCount > 0 ? (
        <div className={styles.selectBar}>
          <span className={styles.selectCount}>選択中 {checkedCount}件</span>
          <span className={styles.spacer} />
          <Button
            variant="primary"
            size="compact"
            busy={bulkBusy}
            busyLabel="受付中…"
            disabled={!canManage || bulkBusy}
            onClick={onBulkAccept}
          >
            まとめて受け付ける
          </Button>
        </div>
      ) : null}

      <DataTable className={styles.table} data-design="kDQHr" label="デリバリーの注文一覧"><thead>
        <TableHeadRow>
          <Th className={styles.th}>
            <Checkbox
              aria-label="新着の注文をすべて選ぶ"
              checked={allChecked}
              indeterminate={someChecked}
              disabled={!canManage || selectableIds.length === 0 || bulkBusy}
              onCheckedChange={onToggleSelectAll}
            />
          </Th>
          <Th className={styles.th}>注文番号</Th>
          <Th className={styles.th}>サービス</Th>
          <Th className={styles.th}>注文内容</Th>
          <Th className={styles.th} align="right">
            金額
          </Th>
          <Th className={styles.th} align="right">
            経過
          </Th>
          <Th className={styles.th}>急ぎ度</Th>
          <Th className={styles.th}>状態</Th>
          <Th className={styles.th} align="right">
            操作
          </Th>
        </TableHeadRow></thead><tbody>
        {visible.length === 0 ? (
          <TableStateRow
            colSpan={COLUMN_COUNT}
            kind="empty"
            title="この状態の注文はありません"
            description="新しい注文が届くと、ここに表示されます。"
          />
        ) : (
          visible.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              nowMs={nowMs}
              busy={busyOrderId === order.id || bulkBusy}
              canManage={canManage}
              checked={selectedSet.has(order.id)}
              selectable={canManage && order.status === 'new'}
              onToggleSelect={onToggleSelect}
              onOpen={onOpenOrder}
              onAccept={onAccept}
              onReject={onReject}
              onReady={onReady}
            />
          ))
        )}
      </tbody></DataTable>

      <div className={styles.tableFoot}>
        <p className={styles.muted}>
          {countText(total)}中 1〜{visible.length}件を表示
        </p>
        <span className={styles.spacer} />
        {visible.length < data.orders.length ? (
          <Button size="compact" onClick={onShowMore}>
            さらに表示
          </Button>
        ) : null}
      </div>
    </>
  )
}
