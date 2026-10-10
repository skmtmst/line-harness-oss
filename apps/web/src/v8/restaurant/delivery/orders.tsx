'use client'

/*
 * ★V8 デリバリー受注・注文一覧（板 `kDQHr`）。
 *
 * 画面は受け取った数と状態を出すだけにする。送信・状態の進みは親（delivery.tsx）が持つ。
 * 急ぎ度の判定はWorker側だけで行い、ここには結果と理由の文しか来ない（仕組みの名前は出さない）。
 */

import { Banknote, Clock, ShoppingBag, Timer, Zap, type LucideIcon } from 'lucide-react'
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
/* 絵（kDQHr）の札の地と字。受付中は青（$info-soft/$action）、停止中は灰（$ink-faint）。 */
const INTAKE_TONES: Record<DeliveryIntakeStatus, StatusBadgeTone> = { open: 'info', stopped: 'neutral' }

/* 絵（kDQHr）のサービス印に出す一文字。 */
const SERVICE_MARKS: Record<DeliveryService, string> = {
  ubereats: 'U',
  demaecan: '出',
  rocketnow: 'ロ',
}

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

/*
 * 絵（kDQHr）の急ぎ度の札は色の点ではなく12pxの印＋字。
 * 急ぎは雷（`ATXE5`）、注意は時計（`qtesW`）、ふつうは印なしの字だけ（`C0hA1v`）。
 */
const URGENCY_ICONS: Record<DeliveryUrgency, LucideIcon | null> = {
  urgent: Zap,
  watch: Clock,
  normal: null,
}

/** 一覧の急ぎ度の札（絵 `HbgSR`/`O1JQq`/`C0hA1v`）。点は出さない。 */
function UrgencyBadge({ urgency }: { urgency: DeliveryUrgency }) {
  const Icon = URGENCY_ICONS[urgency]
  return (
    <StatusBadge
      tone={URGENCY_TONES[urgency]}
      size="compact"
      dot={false}
      className={styles.urgencyBadge}
    >
      {Icon ? <Icon size={12} aria-hidden="true" /> : null}
      {urgencyLabel(urgency)}
    </StatusBadge>
  )
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
/** 閲覧のみの人には「選ぶ」の列を出さないので1つ少ない（★V8 2026-10-06）。 */
const COLUMN_COUNT_VIEW_ONLY = COLUMN_COUNT - 1

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

/* 絵（yrLKt）の増減は色付きの札。点は無い。取れないときは札を出さない。 */
function deltaBadge(text: string | undefined, tone: StatusBadgeTone) {
  if (!text) return undefined
  return (
    <StatusBadge tone={tone} size="compact" dot={false}>
      {text}
    </StatusBadge>
  )
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
  /* 絵（kDQHr）の札は1行。いつまで止めているかは札の説明に入れ、行を増やさない。 */
  const stopNote = stopped && state.stopUntil ? `${formatClock(state.stopUntil)} まで停止` : undefined
  /* 数は推測しない。取れないときは「—」で、単位も出さない（D021/D024）。 */
  const hasCount = typeof state.todayCount === 'number' && Number.isFinite(state.todayCount)
  return (
    <div className={styles.serviceCard}>
      <span className={styles.serviceMark} aria-hidden="true">
        {SERVICE_MARKS[state.service]}
      </span>
      <div className={styles.serviceMid}>
        <span className={styles.serviceName}>{label}</span>
        <span className={styles.serviceBadges}>
          <StatusBadge tone={CONNECTION_TONES[state.connectionStatus]} size="compact">
            {CONNECTION_LABELS[state.connectionStatus]}
          </StatusBadge>
          <span title={stopNote}>
            <StatusBadge tone={INTAKE_TONES[state.intakeStatus]} size="compact">
              {INTAKE_LABELS[state.intakeStatus]}
            </StatusBadge>
          </span>
        </span>
      </div>
      <span className={styles.spacer} />
      <div className={styles.serviceStat}>
        <span className={styles.serviceCount}>
          {hasCount ? state.todayCount : DASH}
          {hasCount ? <span className={styles.serviceCountUnit}>件</span> : null}
        </span>
        <span className={styles.serviceCaption}>本日の注文</span>
      </div>
      {canManage ? (
        stopped ? (
          /*
           * 絵（kDQHr `zFulL`）の「再開」は字2つぶんの小さな札（44px）。
           * 共通のボタンは押している間に幅が動かないよう、「押している間の文字＋
           * 回る印（21px）」と「終わったときの文字＋21px」も先に測って幅に留める。
           * 既定のままだと「保存しました」（6字）で測られて106pxまで広がり、
           * 左の札（接続中・停止中）の居場所を奪って「本日の注文」が2行目へ回る。
           * この札には回る印と文字を並べる幅が無いので、文字を空にして回る印だけを
           * 出す。読み上げは `aria-label` と `aria-busy` が伝える（共通部品は他の
           * 画面でも使うので触らない）。
           */
          <Button
            size="compact"
            className={`${styles.svcAction} ${styles.svcResume}`}
            busy={busy}
            busyLabel=""
            doneLabel=""
            aria-label={`${label}の受付を再開`}
            onClick={() => onResume(state.service)}
          >
            再開
          </Button>
        ) : (
          <Button
            size="compact"
            className={`${styles.svcAction} ${styles.svcStop}`}
            aria-label={`${label}の受付を停止`}
            onClick={() => onStop(state.service)}
          >
            停止
          </Button>
        )
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
      {/* 閲覧のみの人には「選ぶ」を押せない形で置かずに列ごと出さない（★V8 2026-10-06）。 */}
      {canManage ? (
        <Td className={styles.td}>
          <Checkbox
            aria-label={`注文${order.orderNumber}を選ぶ`}
            checked={checked}
            disabled={!selectable || busy}
            onCheckedChange={(next) => onToggleSelect(order.id, next)}
          />
        </Td>
      ) : null}
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
        {/* 絵のサービス札（kDQHr `jrPce` ほか）は点なしの丸い札。状態札とは違い点を出さない。 */}
        <StatusBadge tone={SERVICE_TONES[order.service]} size="compact" dot={false}>
          {order.serviceLabel || DELIVERY_SERVICE_LABELS[order.service]}
        </StatusBadge>
      </Td>
      <Td className={styles.td}>
        <span className={styles.items} title={order.itemSummary}>
          {order.itemSummary || DASH}
        </span>
      </Td>
      {/* 絵（kDQHr）の「金額」「経過」は中身も列の左端から始まる（`セル 金額`/`セル 経過`）。 */}
      <Td className={styles.td}>
        <span className={styles.amount}>{formatYen(order.totalAmount)}</span>
      </Td>
      <Td className={styles.td}>
        <span className={styles.elapsed}>{formatElapsed(order.receivedAt, nowMs)}</span>
      </Td>
      <Td className={styles.td}>
        {/* 絵（kDQHr）の一覧は印だけ。理由の文は幅を押し広げるので注文の詳細（hjdqV）で出す。 */}
        <span className={styles.urgencyCell} title={order.urgencyReason || undefined}>
          <UrgencyBadge urgency={order.urgency} />
        </span>
      </Td>
      <Td className={styles.td}>
        <StatusBadge tone={STATUS_TONES[order.status]} size="compact">
          {order.statusLabel || DASH}
        </StatusBadge>
      </Td>
      <Td className={styles.td}>
        <span className={styles.rowActions}>
          {order.status === 'new' && canManage ? (
            <>
              {/*
                * 絵（kDQHr `HYOW5`）の「受け付ける」は 字12・左右の余白10 で約80px。
                * 共通のボタンは押している間に幅がぶれないよう、平常時の幅と
                * 「押している間の文字＋回る印（21px）」と「終わったときの文字＋21px」の
                * うち一番広いものを幅に留める。
                * 終わったときの文字を書かないと既定の「保存しました」（6字）で測られ、
                * 平常時よりずっと広がって絵からはみ出す。この行は受け付ける操作なので
                * 「保存しました」は文言としても合わない。
                * 押している間の文字も「受付中…」の4字ではなく点々を外した3字にして、
                * 回る印を足しても平常時の幅に収まるようにする。一番広いのが平常時の
                * 「受け付ける」になれば、留める幅は見た目に出ない
                * （共通部品は他の画面も使うので触らない）。
                */}
              <Button
                variant="primary"
                size="compact"
                busy={busy}
                busyLabel="受付中"
                doneLabel="受付済"
                aria-label={`注文${order.orderNumber}を受け付ける`}
                onClick={() => onAccept(order)}
              >
                受け付ける
              </Button>
              {/* 絵（kDQHr `AuCyJ`・`HKAi1`）の「拒否」は白地・灰の細枠で、字は #4a5565。 */}
              <Button
                size="compact"
                className={styles.rowActionReject}
                aria-label={`注文${order.orderNumber}を拒否`}
                onClick={() => onReject(order)}
              >
                拒否
              </Button>
            </>
          ) : order.status === 'cooking' && canManage ? (
            /*
             * 絵（kDQHr `WvPd6`・`jEsnn`）の「準備完了」は白地・灰の細枠で、字だけが緑。
             * 緑のべた塗り（variant="primary"）ではないので、既定の白い形のまま
             * 字の色だけ板の中で緑に戻す。
             */
            <Button
              size="compact"
              className={styles.rowActionReady}
              busy={busy}
              busyLabel="変更中"
              doneLabel="準備済"
              aria-label={`注文${order.orderNumber}を準備完了にする`}
              onClick={() => onReady(order)}
            >
              準備完了
            </Button>
          ) : (
            /*
             * 絵（kDQHr `SdVq6`）の「詳細」は枠も地色も無い青い字だけ。
             * 共通の `variant="text" size="inline"` が v8 で 字12・太字600・枠なし・
             * 色 #0b63ce になり、絵とそのまま同じ（注文履歴の注文番号と同じ使い方）。
             */
            <Button
              variant="text"
              size="inline"
              className={styles.rowActionLink}
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
          icon={<ShoppingBag size={13} />}
          value={kpis.todayCount}
          unit="件"
          delta={deltaBadge(signedCount(kpis.todayCountDelta, '件'), 'success')}
          detail={`受け渡し済み ${countText(kpis.handedOverCount)}`}
          menu={<KpiMenu title="本日の注文" onOpenHistory={onOpenHistory} />}
        />
        <KpiCard
          presentation="cell"
          title="本日の売上"
          icon={<Banknote size={13} />}
          value={kpis.todaySales}
          unit=""
          valueText={formatYen(kpis.todaySales)}
          delta={deltaBadge(signedPercent(kpis.todaySalesDeltaPercent), 'success')}
          detail={`平均単価 ${formatYen(kpis.averageAmount)}`}
          menu={<KpiMenu title="本日の売上" onOpenHistory={onOpenHistory} />}
        />
        <KpiCard
          presentation="cell"
          title="急ぎ対応"
          icon={<Zap size={13} />}
          value={kpis.urgentCount}
          unit="件"
          delta={deltaBadge(kpis.urgentCount > 0 ? '要対応' : undefined, 'danger')}
          detail="待ち時間と注文内容から自動判定"
          menu={<KpiMenu title="急ぎ対応" onOpenHistory={onOpenHistory} />}
        />
        <KpiCard
          presentation="cell"
          title="平均準備時間"
          icon={<Timer size={13} />}
          value={kpis.averagePrepMinutes}
          unit="分"
          delta={deltaBadge(signedCount(kpis.averagePrepMinutesDelta, '分'), 'success')}
          detail="目標 15分以内"
          menu={<KpiMenu title="平均準備時間" onOpenHistory={onOpenHistory} />}
        />
      </KpiBand>

      {/* 絵（kDQHr）の並びは サービス3枚 → 数の帯 → タブ → 表。 */}
      <Tabs items={tabs} label="注文の状態" />

      {/* 閲覧のみの人は選べないので、選んだ数の帯もまとめての札も出さない。 */}
      {canManage && checkedCount > 0 ? (
        <div className={styles.selectBar}>
          <span className={styles.selectCount}>選択中 {checkedCount}件</span>
          <span className={styles.spacer} />
          <Button
            variant="primary"
            size="compact"
            busy={bulkBusy}
            busyLabel="受付中…"
            disabled={bulkBusy}
            onClick={onBulkAccept}
          >
            まとめて受け付ける
          </Button>
        </div>
      ) : null}

      <DataTable className={styles.table} data-design="kDQHr" label="デリバリーの注文一覧"><thead>
        <TableHeadRow>
          {canManage ? (
            <Th className={styles.th}>
              <Checkbox
                aria-label="新着の注文をすべて選ぶ"
                checked={allChecked}
                indeterminate={someChecked}
                disabled={selectableIds.length === 0 || bulkBusy}
                onCheckedChange={onToggleSelectAll}
              />
            </Th>
          ) : null}
          <Th className={styles.th}>注文番号</Th>
          <Th className={styles.th}>サービス</Th>
          <Th className={styles.th}>注文内容</Th>
          {/* 絵（kDQHr）の見出しは9つとも列の左端から書き出す（`列 金額`/`列 経過`/`列 操作`）。 */}
          <Th className={styles.th}>金額</Th>
          <Th className={styles.th}>経過</Th>
          <Th className={styles.th}>急ぎ度</Th>
          <Th className={styles.th}>状態</Th>
          <Th className={styles.th}>操作</Th>
        </TableHeadRow></thead><tbody>
        {visible.length === 0 ? (
          <TableStateRow
            colSpan={canManage ? COLUMN_COUNT : COLUMN_COUNT_VIEW_ONLY}
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
