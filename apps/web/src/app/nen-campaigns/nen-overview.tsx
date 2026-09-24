'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Gift, MessageSquare, Newspaper, Package, RotateCw, Send } from 'lucide-react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Disclosure from '@/components/shared/disclosure'
import Drawer from '@/components/shared/drawer'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import PageHeaderH2 from '@/components/layout/page-header-h2'
import Pagination from '@/components/shared/pagination'
import { RowActions } from '@/components/shared/row-actions'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import SummaryCard from '@/components/shared/summary-card'
import KpiCollapse from '@/components/ui/kpi-collapse'
import ListRange from '@/components/ui/list-range'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import { TextArea, TextField } from '@/components/shared/text-field'
import type {
  NenCampaignSetting,
  NenColumn,
  NenColumnMetrics,
  NenDeliveryDetail,
  NenDeliveryList,
  NenFlowMetrics,
} from '@/lib/api'
import { campaignTriggerLabel, formatCampaignAudience, formatCampaignTiming, formatNenJobDateTime } from './campaign-display'
import { isPastScheduledAt, publishedAtIso } from './columns/new/column-form'
import { CampaignLinePreview, COLUMN_PET_NAME_FALLBACK, ColumnLinePreview } from './line-preview'
import { jstLongDateTime, jstShortDate, jstShortDateTime } from './nen-period'

/*
 * NEN配信の一覧。★V6 37-6（`z4q1K`）自動配信／37-6-A（`u66A0`）コラム。
 *
 * タブは 自動配信／コラム／送った履歴／停止中 の4つ。ペットの一覧は
 * 「マイペット」（★V6 37-3）へ移した。誕生日クーポンの決めごとは、誕生日配信の行の
 * その他操作から右パネルで直す。
 *
 * ここは見た目だけを持つ。取得・保存は `page.tsx`。
 */

export type NenTab = 'auto' | 'columns' | 'history' | 'paused'

export type NenCoupon = {
  isEnabled: boolean
  codePrefix: string
  benefitLabel: string
  discountAmount: number
  validityDays: number
  /** 419: 2月29日生まれの子への平年の扱い（リマインダと同じ3択） */
  leapYearPolicy: 'feb28' | 'mar1' | 'skip'
}

/** 数値カード帯（★V6 37-6）。取れなかった値は null。 */
export type NenKpis = {
  monthLabel: string
  sentThisMonth: number | null
  sentLastMonth: number | null
  /** コラムの記事を開いた割合（%）。自動配信は LINE から個人開封を取得できない。 */
  openRate: number | null
  orders: number | null
  orderAmount: number | null
  undelivered: number | null
  blocked: number
  unfollowed: number
}

export type ColumnDeliveryPlan = {
  when: 'now' | 'schedule'
  /** `datetime-local` の値（日本時間）。 */
  scheduledAt: string
}

export type FriendOption = { id: string; displayName: string | null }

const statusLabel: Record<string, string> = {
  pending: 'これから送ります',
  processing: '送信中',
  sent: '送りました',
  skipped: '対象外',
  failed: '届きませんでした',
  cancelled: '取り消し済み',
}

const columnStatusLabel: Record<NenColumn['deliveryStatus'], string> = {
  draft: '未配信',
  scheduled: '予約',
  queued: '配信待ち',
  sent: '配信済み',
}

// #727: skipped の理由の日本語文言(worker の safeFailureReason と同じ意味)。
const skippedReasonLabel: Record<string, string> = {
  friend_unavailable: '友だちが配信対象ではありません',
  line_account_unavailable: 'LINE公式アカウントの送信設定を確認できません',
  line_account_mismatch: '友だちと配信元のLINE公式アカウントが一致しません',
  campaign_snapshot_missing: '予約時の配信内容を確認できません',
  campaign_disabled: '配信の決めごとが停止中です',
  campaign_form_already_submitted: 'すでに回答済みのため送りません',
  campaign_form_unavailable: 'つなぐ回答フォームが使えなくなっているため送りません',
  frequency_suppressed: '近い時期に同じ配信があるため送りません',
  order_cancelled: '注文が取り消されたため送りません',
  order_refunded: '注文が返金になったため送りません',
  unknown: '理由を確認できません',
}

// #727: skipped のうち運用で直せる理由。接続設定のやり直し・配信のオン戻し・
// NEN-07: 回答フォームの選び直しで解消する。
const skippedFixableReasons = new Set(['line_account_unavailable', 'campaign_disabled', 'campaign_form_unavailable'])

// #733: 再送できるのは上限まで失敗した記録と、直せる理由で止まった記録だけ。
// ボタンを出しても最終判断はサーバが行い、前提が直っていなければ409で止める。
function canRetryDelivery(delivery: { status: string; attempts: number; unmetReasonCode: string | null }): boolean {
  if (delivery.status === 'failed') return delivery.attempts >= 5
  if (delivery.status !== 'skipped') return false
  return delivery.unmetReasonCode !== null && skippedFixableReasons.has(delivery.unmetReasonCode)
}

// #733: 直せない理由はボタンを出さず、理由別の説明だけ出す。
const skippedNoRetryNote: Record<string, string> = {
  friend_unavailable: '友だち側の事情のため、この記録は再送できません。',
  campaign_snapshot_missing: '予約内容が残っていないため、この記録は再送できません。',
  line_account_mismatch: 'アカウントが一致しないため、この記録は再送できません。',
  campaign_form_already_submitted: 'すでに回答済みのため、この記録は再送しません。',
  frequency_suppressed: '近い時期の同じ配信を代表1件にまとめたため、この記録は再送しません。',
  order_cancelled: '注文が取り消されたため、この記録は再送しません。注文の状態は「EC連携」の取り込みの記録で確認できます。',
  order_refunded: '注文が返金になったため、この記録は再送しません。注文の状態は「EC連携」の取り込みの記録で確認できます。',
}

function skippedReasonsDetail(skippedReasons: Record<string, number> | undefined): string | null {
  if (!skippedReasons) return null
  const entries = Object.entries(skippedReasons).filter(([, count]) => count > 0)
  if (entries.length === 0) return null
  const fixable = entries
    .filter(([reason]) => skippedFixableReasons.has(reason))
    .reduce((sum, [, count]) => sum + count, 0)
  const breakdown = entries
    .map(([reason, count]) => `${skippedReasonLabel[reason] ?? reason}${skippedFixableReasons.has(reason) ? '(直せます)' : ''} ${count}`)
    .join('・')
  return `送らなかった内訳 ${breakdown}(うち直せる ${fixable})`
}

function num(value: number | null | undefined): string {
  return value == null ? '—' : value.toLocaleString('ja-JP')
}

/** 自動配信の行に付ける印。実キーごと（★V6 37-6 の1列目）。 */
function CampaignIcon({ campaignKey }: { campaignKey: string }) {
  const Icon = campaignKey === 'arrival_check' ? Package
    : campaignKey === 'review_request' ? MessageSquare
      : campaignKey === 'cross_sell' ? RotateCw
        : campaignKey === 'birthday_coupon' ? Gift
          : campaignKey === 'column' ? Newspaper
            : Send
  return (
    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent-deep">
      <Icon size={18} />
    </span>
  )
}

/**
 * テスト送信先の選択。候補は「設定 › アカウント › テスト送信先」に登録した人だけ。
 * 誰も登録されていなければ、選ばせる代わりに登録先へ案内する（押しても届かない状態を作らない）。
 */
function TestRecipientPicker({ friends, value, onChange, accountId }: {
  friends: FriendOption[]
  value: string
  onChange: (id: string) => void
  accountId: string | null
}) {
  if (friends.length === 0) {
    return (
      <span className="flex items-center gap-2 text-caption text-ink-secondary">
        テスト送信先が未登録です
        {accountId ? <Button href={`/accounts/detail?id=${encodeURIComponent(accountId)}`} size="field">テスト送信先を登録</Button> : null}
      </span>
    )
  }
  return <Select aria-label="テスト送信先" value={value} onChange={onChange} options={friends.map((friend) => ({ value: friend.id, label: friend.displayName || '名前未取得' }))} />
}

function Kpis({ kpis, loading }: { kpis: NenKpis | null; loading: boolean }) {
  const month = kpis?.monthLabel ?? '今月'
  return (
    <KpiCollapse data-design="KPIs" data-design-node="nen-kpis" gridClassName="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <SummaryCard variant="v6" title={`${month} 送った数`} value={kpis?.sentThisMonth ?? null} unit="通" detail={kpis ? `先月 ${num(kpis.sentLastMonth)}通` : '—'} loading={loading} />
      <SummaryCard variant="v6" title="開封" value={null} unit="%" valueText={kpis?.openRate == null ? '—' : `${kpis.openRate}%`} detail="コラムを開いた割合（自動配信はLINEから個人開封を取得できません）" loading={loading} />
      <SummaryCard variant="v6" title="配信からの注文" value={kpis?.orders ?? null} unit="件" detail={kpis?.orderAmount == null ? '送信後7日以内の注文' : `¥${num(kpis.orderAmount)}（送信後7日以内）`} loading={loading} />
      <SummaryCard variant="v6" title="届かなかった" value={kpis?.undelivered ?? null} unit="通" detail={kpis ? `友だち解除 ${num(kpis.unfollowed)}・ブロック ${num(kpis.blocked)}` : '友だち解除・ブロック'} loading={loading} />
    </KpiCollapse>
  )
}

export type NenOverviewProps = {
  tab: NenTab
  topAction: ReactNode
  onTabChange: (tab: NenTab) => void
  settings: NenCampaignSetting[]
  columns: NenColumn[]
  /** コラムの全体件数（口は既定200件で打ち切る）。一覧より多ければ打ち切りを出す（#935 N-300）。 */
  columnsTotal: number | null
  kpis: NenKpis | null
  flowMetrics: NenFlowMetrics | null
  columnMetrics: NenColumnMetrics | null
  deliveryList: NenDeliveryList | null
  deliveryDetail: NenDeliveryDetail | null
  friends: FriendOption[]
  testFriendId: string
  onTestFriendChange: (id: string) => void
  /** 選択中の LINE アカウント。テスト送信先の登録画面へ案内するために使う。 */
  accountId: string | null
  loading: boolean
  notice: { tone: 'success' | 'error'; text: string } | null
  // 自動配信・停止中
  saving: string | null
  testing: string | null
  previewCampaignKey: string | null
  onPreviewCampaign: (key: string | null) => void
  onToggleSetting: (setting: NenCampaignSetting) => void
  onTestSend: (setting: NenCampaignSetting) => void
  // 誕生日クーポンの決めごと（誕生日配信の行から開く）
  coupon: NenCoupon
  couponOpen: boolean
  onCouponOpenChange: (open: boolean) => void
  onCouponChange: (coupon: NenCoupon) => void
  onSaveCoupon: () => void
  savingCoupon: boolean
  // コラム
  selectedColumnId: string | null
  onSelectColumn: (id: string | null) => void
  audienceCount: number | null
  plan: ColumnDeliveryPlan
  onPlanChange: (plan: ColumnDeliveryPlan) => void
  introDraft: string
  onIntroChange: (text: string) => void
  onSaveIntro: (column: NenColumn) => void
  savingColumnId: string | null
  onDeliverColumn: (column: NenColumn, scheduledAt?: string) => void
  onDuplicateColumn: (column: NenColumn) => void
  onTestColumn: (column: NenColumn) => void
  // 送った履歴
  onShowDelivery: (id: string) => void
  onRetryDelivery: (id: string, version: number, reason: string) => void
  onChangeDeliveryView: (status?: string, cursor?: string, q?: string) => void
}

export function NenOverview({
  tab,
  topAction,
  onTabChange,
  settings,
  columns,
  columnsTotal,
  kpis,
  flowMetrics,
  columnMetrics,
  deliveryList,
  deliveryDetail,
  friends,
  testFriendId,
  onTestFriendChange,
  accountId,
  loading,
  notice,
  saving,
  testing,
  previewCampaignKey,
  onPreviewCampaign,
  onToggleSetting,
  onTestSend,
  coupon,
  couponOpen,
  onCouponOpenChange,
  onCouponChange,
  onSaveCoupon,
  savingCoupon,
  selectedColumnId,
  onSelectColumn,
  audienceCount,
  plan,
  onPlanChange,
  introDraft,
  onIntroChange,
  onSaveIntro,
  savingColumnId,
  onDeliverColumn,
  onDuplicateColumn,
  onTestColumn,
  onShowDelivery,
  onRetryDelivery,
  onChangeDeliveryView,
}: NenOverviewProps) {
  // コラムは自分のタブを持つので、自動配信の表には出さない。
  const autoSettings = settings.filter((setting) => setting.category !== 'column')
  const pausedSettings = autoSettings.filter((setting) => !setting.isEnabled)
  const previewSetting = previewCampaignKey ? settings.find((setting) => setting.campaignKey === previewCampaignKey) ?? null : null
  const columnSetting = settings.find((setting) => setting.category === 'column') ?? null

  return (
    /* 横の余白は外の枠（AppShell）が持つ。ここで足すと他の画面より右へずれる。 */
    <main data-design-node={tab === 'columns' ? 'u66A0' : 'z4q1K'} className="mx-auto flex w-full flex-col gap-4 pb-8" style={{ maxWidth: 1600 }}>
      <div data-design="Crumb" data-design-node="nen-header">
        <PageHeaderH2
          breadcrumb={[{ label: '専用機能' }, { label: 'NEN配信' }]}
          title="NEN配信"
          description=""
          actions={topAction}
        />
      </div>
      <div data-design="Tabs" data-design-node="nen-tabs">
        <Tabs
          items={[
            { label: '自動配信', count: autoSettings.length, current: tab === 'auto', onClick: () => onTabChange('auto') },
            { label: 'コラム', count: columns.length, current: tab === 'columns', onClick: () => onTabChange('columns') },
            { label: '送った履歴', current: tab === 'history', onClick: () => onTabChange('history') },
            { label: '停止中', count: pausedSettings.length, current: tab === 'paused', onClick: () => onTabChange('paused') },
          ]}
        />
      </div>
      <Kpis kpis={kpis} loading={loading && kpis === null} />
      {notice && tab !== 'columns' ? <NoteBar tone={notice.tone === 'success' ? 'info' : 'danger'}>{notice.text}</NoteBar> : null}
      {tab === 'auto' || tab === 'paused' ? (
        <AutoPanel
          settings={tab === 'paused' ? pausedSettings : autoSettings}
          pausedOnly={tab === 'paused'}
          metrics={flowMetrics}
          monthLabel={kpis?.monthLabel ?? '今月'}
          loading={loading}
          saving={saving}
          onPreview={onPreviewCampaign}
          onToggle={onToggleSetting}
          onTestSend={onTestSend}
          onEditCoupon={() => onCouponOpenChange(true)}
          testFriendId={testFriendId}
        />
      ) : null}
      {tab === 'columns' ? (
        <ColumnsPanel
          columns={columns}
          columnsTotal={columnsTotal}
          metrics={columnMetrics}
          loading={loading}
          selectedColumnId={selectedColumnId}
          onSelect={onSelectColumn}
          audienceCount={audienceCount}
          plan={plan}
          onPlanChange={onPlanChange}
          introDraft={introDraft}
          onIntroChange={onIntroChange}
          onSaveIntro={onSaveIntro}
          savingColumnId={savingColumnId}
          onDeliver={onDeliverColumn}
          onDuplicate={onDuplicateColumn}
          onTest={onTestColumn}
          columnEnabled={columnSetting?.isEnabled ?? true}
          columnSetting={columnSetting}
          onToggleCampaign={onToggleSetting}
          savingCampaignKey={saving}
          buttonLabel={columnSetting?.buttonLabel || 'コラムを読む'}
          friends={friends}
          testFriendId={testFriendId}
          onTestFriendChange={onTestFriendChange}
          accountId={accountId}
          testing={testing}
          notice={notice}
        />
      ) : null}
      {tab === 'history' ? (
        <HistoryPanel deliveryList={deliveryList} detail={deliveryDetail} loading={loading} onShowDetail={onShowDelivery} onRetry={onRetryDelivery} onChangeView={onChangeDeliveryView} />
      ) : null}

      <Drawer
        open={previewSetting !== null}
        title={previewSetting ? `${previewSetting.label}の中身` : '配信の中身'}
        description="お客様ごとの情報は見本に置き換えています。"
        onClose={() => onPreviewCampaign(null)}
        footer={previewSetting ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <TestRecipientPicker friends={friends} value={testFriendId} onChange={onTestFriendChange} accountId={accountId} />
            <Button type="button" variant="primary" disabled={!testFriendId || testing === previewSetting.campaignKey} onClick={() => onTestSend(previewSetting)}>{testing === previewSetting.campaignKey ? '送信中…' : '自分にテスト送信'}</Button>
          </div>
        ) : undefined}
      >
        {previewSetting ? (
          <div className="flex flex-col gap-3">
            <p className="text-caption text-ink-secondary">{formatCampaignTiming(previewSetting)}に、{formatCampaignAudience(previewSetting)}へ届きます。</p>
            <CampaignLinePreview setting={previewSetting} />
            <p className="text-micro text-ink-faint">テスト送信は「設定 › アカウント › テスト送信先」に登録した、友だち追加中の人にだけ送ります。</p>
          </div>
        ) : null}
      </Drawer>

      <CouponDrawer open={couponOpen} coupon={coupon} saving={savingCoupon} onClose={() => onCouponOpenChange(false)} onChange={onCouponChange} onSave={onSaveCoupon} />
    </main>
  )
}

/* ───────────── 自動配信／停止中 ───────────── */

type AutoSort = 'sent_desc' | 'name'

function AutoPanel({
  settings,
  pausedOnly,
  metrics,
  monthLabel,
  loading,
  saving,
  onPreview,
  onToggle,
  onTestSend,
  onEditCoupon,
  testFriendId,
}: {
  settings: NenCampaignSetting[]
  pausedOnly: boolean
  metrics: NenFlowMetrics | null
  monthLabel: string
  loading: boolean
  saving: string | null
  onPreview: (key: string | null) => void
  onToggle: (setting: NenCampaignSetting) => void
  onTestSend: (setting: NenCampaignSetting) => void
  onEditCoupon: () => void
  testFriendId: string
}) {
  const [search, setSearch] = useState('')
  const [trigger, setTrigger] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState<AutoSort>('sent_desc')

  const metricFor = (setting: NenCampaignSetting) => metrics?.flows.find((flow) => flow.campaignKey === setting.campaignKey)
  const shown = settings
    .filter((setting) => setting.label.toLowerCase().includes(search.trim().toLowerCase()))
    .filter((setting) => !trigger || setting.category === trigger)
    .filter((setting) => !status || (status === 'on' ? setting.isEnabled : !setting.isEnabled))
    .sort((a, b) => sort === 'name'
      ? a.label.localeCompare(b.label, 'ja')
      : (metricFor(b)?.sent ?? 0) - (metricFor(a)?.sent ?? 0))
  const triggers = [...new Set(settings.map((setting) => setting.category))]

  return (
    <>
      <div data-design="Note" data-design-node="nen-auto-note" className="flex flex-col gap-3">
        <NoteBar tone="info">
          {pausedOnly
            ? '止めている配信です。「動かす」を押すと、次のきっかけから自動で送ります。止めている間のきっかけは送りません。'
            : '然の出来事（注文・発送・ペット登録・記録・誕生日）をきっかけに、決めた日数後に自動で送ります。'}
        </NoteBar>
        {pausedOnly ? null : (
          <Disclosure size="compact" title="送られる仕組み">
            <p className="text-caption leading-6 text-ink-secondary">
              文面にはペット名・クーポンを差し込めます。取引の通知（注文受付・発送）は「設定 › LINE通知」で管理します。注文が取り消し・返金になったあとの案内は自動で止まります。きっかけの記録と定期便の次の発送は{' '}
              <Link href="/ec-commerce?tab=subscriptions" className="font-semibold underline">EC連携</Link>
              {' '}で確認できます。
            </p>
          </Disclosure>
        )}
      </div>

      <div data-design="ListControls" data-design-node="nen-auto-controls" className="flex flex-wrap items-center gap-3">
        <div className="min-w-64 flex-1">
          <TextField aria-label="配信名で検索" placeholder="配信名で検索" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <Select
          aria-label="きっかけで絞り込む"
          value={trigger}
          onChange={setTrigger}
          options={[{ value: '', label: 'きっかけ：すべて' }, ...triggers.map((category) => ({ value: category, label: `きっかけ：${campaignTriggerLabel[category]}` }))]}
        />
        {pausedOnly ? null : (
          <Select
            aria-label="状態で絞り込む"
            value={status}
            onChange={setStatus}
            options={[{ value: '', label: '状態：すべて' }, { value: 'on', label: '状態：配信中' }, { value: 'off', label: '状態：停止中' }]}
          />
        )}
        {/*
          選択肢の文が長いとトリガー内で省略される。共通部品は触れないため、
          外側の title で全文を読めるようにする（第5パス D-3）。
        */}
        <div className="w-full sm:w-64" title={sort === 'name' ? '並び：名前順' : `並び：${monthLabel}の送信が多い順`}>
          <Select
            aria-label="並び順"
            size="full"
            value={sort}
            onChange={(value) => setSort(value === 'name' ? 'name' : 'sent_desc')}
            options={[{ value: 'sent_desc', label: `並び：${monthLabel}の送信が多い順` }, { value: 'name', label: '並び：名前順' }]}
          />
        </div>
        <span className="ml-auto text-caption font-semibold text-ink-faint">{shown.length}件</span>
      </div>

      {/* 開封の列は「—」しか並ばないので置かず、理由だけここに残す。 */}
      <p className="text-micro text-ink-faint">自動配信は開封を取得できません。</p>

      <section data-design="Table" data-design-node="nen-auto-table">
        {loading && settings.length === 0 ? (
          <ListState kind="loading" title="配信を読み込んでいます" />
        ) : settings.length === 0 ? (
          pausedOnly
            ? <ListState kind="empty" emptyPreset="readonly" title="止めている配信はありません" description="すべての自動配信が動いています。" />
            : <ListState kind="empty" emptyPreset="readonly" title="自動配信はまだありません" description="EC連携から注文の流れを接続すると、ここに配信が並びます。" />
        ) : shown.length === 0 ? (
          <ListState kind="empty" emptyPreset="readonly" title="条件に合う配信はありません" description="検索や絞り込みを変えてみてください。" />
        ) : (
          <DataTable>
            <thead>
              <TableHeadRow>
                <Th>配信</Th>
                <Th className="w-56">きっかけ</Th>
                <Th className="w-44">対象</Th>
                <Th className="w-24" align="right">{monthLabel} 送信</Th>
                <Th className="w-20" align="right">注文</Th>
                <Th className="w-24">状態</Th>
                {/*
                  #707: 390pxで表を横スクロールしたとき、操作列だけ右端に
                  留める（PC幅では自然位置なので見た目は変わらない）。
                */}
                <Th className="w-28 sticky right-0 bg-surface-pearl" align="right"><span className="sr-only">操作</span></Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {shown.map((setting) => {
                const metric = metricFor(setting)
                const busy = saving === setting.campaignKey
                const menuItems = [
                  { id: 'preview', label: '中身を見る', onSelect: () => onPreview(setting.campaignKey) },
                  { id: 'test', label: '自分にテスト送信', disabled: !testFriendId, onSelect: () => onTestSend(setting) },
                  ...(setting.category === 'birthday' ? [{ id: 'coupon', label: 'クーポンの決めごと', onSelect: onEditCoupon }] : []),
                  { id: 'toggle', label: setting.isEnabled ? '止める' : '動かす', disabled: busy, dividerBefore: true, onSelect: () => onToggle(setting) },
                ]
                return (
                  <Tr key={setting.campaignKey}>
                    <Td>
                      <span className="flex items-center gap-3">
                        <CampaignIcon campaignKey={setting.campaignKey} />
                        <span className="min-w-0">
                          <span className="block truncate text-label font-semibold text-ink" title={setting.label}>{setting.label}</span>
                          <span className="block truncate text-micro text-ink-faint" title={setting.title}>{setting.title}</span>
                        </span>
                      </span>
                    </Td>
                    <Td><span className="text-label text-ink-secondary">{formatCampaignTiming(setting)}</span></Td>
                    <Td><span className="text-label text-ink-secondary">{formatCampaignAudience(setting)}</span></Td>
                    <Td align="right"><span className="text-label font-semibold tabular-nums text-ink">{num(metric?.sent ?? null)}</span></Td>
                    <Td align="right">
                      {metric && metric.associatedConversions > 0
                        ? <span className="text-label font-semibold tabular-nums text-ink" title={`¥${num(metric.associatedConversionAmount)}（送信後7日以内）`}>{num(metric.associatedConversions)}件</span>
                        : <span className="text-label tabular-nums text-ink-faint">—</span>}
                    </Td>
                    <Td>
                      {/*
                        NEN-07: つなぐ回答フォームが使えない配信は「設定不足」。
                        この間は新しい配信jobが積まれない(履歴に理由が残る)。
                      */}
                      {setting.formIssue
                        ? <StatusBadge tone="danger" size="compact" title="つなぐ回答フォームが使えなくなっています。編集画面で選び直してください">設定不足</StatusBadge>
                        : setting.isEnabled
                          ? <StatusBadge tone="success" size="compact">配信中</StatusBadge>
                          : <StatusBadge tone="warning" size="compact">停止中</StatusBadge>}
                    </Td>
                    <Td align="right" className="sticky right-0 bg-canvas">
                      {/*
                        #985 LAY-18: 行の操作は共用の RowActions。
                        「編集」＋「⋯」（中身を見る・テスト送信・止める/動かす）の
                        並びを部品へ委ね、画面ごとの手組みへは戻さない。
                      */}
                      <RowActions
                        subjectName={setting.label}
                        edit={{ href: `/nen-campaigns/edit?key=${encodeURIComponent(setting.campaignKey)}` }}
                        menuItems={menuItems}
                      />
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        )}
      </section>
    </>
  )
}

/* ───────────── 誕生日クーポンの決めごと ───────────── */

function CouponDrawer({ open, coupon, saving, onClose, onChange, onSave }: {
  open: boolean
  coupon: NenCoupon
  saving: boolean
  onClose: () => void
  onChange: (coupon: NenCoupon) => void
  onSave: () => void
}) {
  return (
    <Drawer
      open={open}
      title="誕生日クーポンの決めごと"
      description="誕生日は3日前の10:00に送ります。名前と誕生日は、マイページで登録されたペット情報を使います。"
      busy={saving}
      onClose={onClose}
      footer={<Button type="button" variant="primary" disabled={saving} onClick={onSave}>{saving ? '保存中…' : '設定を保存'}</Button>}
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-caption font-semibold text-ink">
          割引の額（円）
          <TextField type="number" min={1} max={100000} inputMode="numeric" value={coupon.discountAmount} onChange={(event) => onChange({ ...coupon, discountAmount: Number(event.target.value) })} />
        </label>
        <label className="flex flex-col gap-1 text-caption font-semibold text-ink">
          使える日数
          <TextField type="number" min={1} max={365} inputMode="numeric" value={coupon.validityDays} onChange={(event) => onChange({ ...coupon, validityDays: Number(event.target.value) })} />
        </label>
        <label className="flex flex-col gap-1 text-caption font-semibold text-ink">
          クーポンの頭の文字
          <TextField value={coupon.codePrefix} maxLength={10} onChange={(event) => onChange({ ...coupon, codePrefix: event.target.value.toUpperCase() })} />
          <span className="text-micro font-normal text-ink-faint">半角大文字・数字・- で3〜10文字。発行されるクーポンは「{coupon.codePrefix || 'NENBDAY'}-1234」のようになります。</span>
        </label>
        <div className="flex flex-col gap-1 text-caption font-semibold text-ink">
          2月29日生まれの子
          <Select
            aria-label="2月29日生まれの子への平年の扱い"
            size="full"
            value={coupon.leapYearPolicy}
            onChange={(value) => onChange({ ...coupon, leapYearPolicy: value === 'mar1' || value === 'skip' ? value : 'feb28' })}
            options={[{ value: 'feb28', label: '2月28日に送る' }, { value: 'mar1', label: '3月1日に送る' }, { value: 'skip', label: 'その年は送らない' }]}
          />
        </div>
        <p className="text-micro text-ink-faint">クーポンが使われた記録は「コンバージョン」で確認できます。</p>
      </div>
    </Drawer>
  )
}

/* ───────────── コラム ───────────── */

type ColumnDeliveryFilter = '' | 'draft' | 'scheduled' | 'sent'

function columnDeliveryBadge(column: NenColumn) {
  if (column.deliveryStatus === 'sent') return <StatusBadge tone="success" size="compact">配信済み {jstShortDate(column.deliveryAt)}</StatusBadge>
  if (column.deliveryStatus === 'scheduled') return <StatusBadge tone="warning" size="compact">予約 {jstShortDateTime(column.deliveryAt)}</StatusBadge>
  if (column.deliveryStatus === 'queued') return <StatusBadge tone="info" size="compact">配信待ち {jstShortDateTime(column.deliveryAt)}</StatusBadge>
  /*
   * NEN-06: 下書きに記録された「配信したい日時」を見せる。
   * 予約ではない（delivery_status は draft のまま、配信待ち行列も作らない）ため、
   * 「予約」「配信待ち」とは別の文言で出す。
   */
  if (column.deliveryStatus === 'draft' && column.deliveryAt) {
    return <StatusBadge tone="neutral" size="compact">未配信・{jstShortDateTime(column.deliveryAt)} に出したい</StatusBadge>
  }
  return <StatusBadge tone="neutral" size="compact">{columnStatusLabel[column.deliveryStatus]}</StatusBadge>
}

function ColumnsPanel({
  columns,
  columnsTotal,
  metrics,
  loading,
  selectedColumnId,
  onSelect,
  audienceCount,
  plan,
  onPlanChange,
  introDraft,
  onIntroChange,
  onSaveIntro,
  savingColumnId,
  onDeliver,
  onDuplicate,
  onTest,
  columnEnabled,
  columnSetting,
  onToggleCampaign,
  savingCampaignKey,
  buttonLabel,
  friends,
  testFriendId,
  onTestFriendChange,
  accountId,
  testing,
  notice,
}: {
  columns: NenColumn[]
  /** 口が返す全体件数。一覧より多いとき打ち切りを示す（#935 N-300）。 */
  columnsTotal: number | null
  metrics: NenColumnMetrics | null
  loading: boolean
  selectedColumnId: string | null
  onSelect: (id: string | null) => void
  audienceCount: number | null
  plan: ColumnDeliveryPlan
  onPlanChange: (plan: ColumnDeliveryPlan) => void
  introDraft: string
  onIntroChange: (text: string) => void
  onSaveIntro: (column: NenColumn) => void
  savingColumnId: string | null
  onDeliver: (column: NenColumn, scheduledAt?: string) => void
  onDuplicate: (column: NenColumn) => void
  onTest: (column: NenColumn) => void
  columnEnabled: boolean
  /** コラム配信の決めごと（nen_campaign_settings の 'column' 行）。停止・再開の制御に使う。 */
  columnSetting: NenCampaignSetting | null
  onToggleCampaign: (setting: NenCampaignSetting) => void
  savingCampaignKey: string | null
  buttonLabel: string
  friends: FriendOption[]
  testFriendId: string
  onTestFriendChange: (id: string) => void
  accountId: string | null
  testing: string | null
  notice: { tone: 'success' | 'error'; text: string } | null
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [delivery, setDelivery] = useState<ColumnDeliveryFilter>('')
  const [page, setPage] = useState(1)
  /* 配信予約は確認なしのワンクリックにしない(点検 #512 の中9)。 */
  const [confirmDeliver, setConfirmDeliver] = useState<{ column: NenColumn; scheduledAt?: string } | null>(null)

  const pageSize = 8
  const shown = useMemo(() => columns
    .filter((column) => `${column.title} ${column.excerpt}`.toLowerCase().includes(search.trim().toLowerCase()))
    .filter((column) => !category || (column.category ?? '') === category)
    .filter((column) => !delivery || (delivery === 'scheduled' ? column.deliveryStatus === 'scheduled' || column.deliveryStatus === 'queued' : column.deliveryStatus === delivery))
    .sort((a, b) => String(b.publishedAt ?? b.updatedAt).localeCompare(String(a.publishedAt ?? a.updatedAt))), [columns, search, category, delivery])
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visible = shown.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const categories = [...new Set(columns.map((column) => column.category).filter((value): value is string => Boolean(value)))]
  const selected = columns.find((column) => column.id === selectedColumnId) ?? null
  const scheduledIso = plan.when === 'schedule' ? publishedAtIso(plan.scheduledAt) : null
  /*
   * #935 N-304: 過去の予約日時はWorkerの次のtickで即送されるため「予約」にならない。
   * Worker側も断るが、ここで先に止めて「いまより先を選ぶ」と言う。
   */
  const schedulePast = plan.when === 'schedule' && isPastScheduledAt(plan.scheduledAt)
  const scheduleInvalid = plan.when === 'schedule' && (!scheduledIso || schedulePast)
  const planLabel = selected
    ? plan.when === 'now'
      ? `「${selected.title}」を今すぐ送る`
      : !scheduledIso
        ? `「${selected.title}」の予約日時を入れてください`
        : schedulePast
          ? `「${selected.title}」の予約日時はいまより先を選んでください`
          : `「${selected.title}」を ${jstShortDateTime(scheduledIso)} に予約`
    : 'コラムを選ぶと、ここに予定が出ます'
  const introDirty = selected !== null && introDraft !== selected.introText
  // 口は既定200件で打ち切る。一覧より全体が多いなら、黙って切らない（#935 N-300）。
  const columnsTruncated = columnsTotal !== null && columnsTotal > columns.length

  return (
    <>
      <div data-design="Note" data-design-node="nen-columns-note">
        <NoteBar tone="info">
          ECサイトのジャーナル（コラム）は公開すると自動でここに届きます。配信したいコラムを選び、LINEのカード（見出し・画像・抜粋・「{buttonLabel}」ボタン）を確認して、今すぐ送るか日時を予約します。コラムは売り込みをしない配信です。
        </NoteBar>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          <div data-design="ListControls" data-design-node="nen-columns-controls" className="flex flex-wrap items-center gap-3">
            <div className="min-w-64 flex-1">
              <TextField aria-label="コラムの題名で検索" placeholder="コラムの題名で検索" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
            </div>
            <Select
              aria-label="分類で絞り込む"
              value={category}
              onChange={(value) => { setCategory(value); setPage(1) }}
              options={[{ value: '', label: '分類：すべて' }, ...categories.map((value) => ({ value, label: `分類：${value}` }))]}
            />
            <Select
              aria-label="配信の状態で絞り込む"
              value={delivery}
              onChange={(value) => { setDelivery(value === 'draft' || value === 'scheduled' || value === 'sent' ? value : ''); setPage(1) }}
              options={[{ value: '', label: '配信：すべて' }, { value: 'draft', label: '配信：未配信' }, { value: 'scheduled', label: '配信：予約' }, { value: 'sent', label: '配信：配信済み' }]}
            />
            <span className="ml-auto text-caption font-semibold text-ink-faint">
              {columnsTruncated ? `${shown.length}本（全体 ${num(columnsTotal)}本）` : `${shown.length}本`}
            </span>
          </div>

          {/* #935 N-300: 口の既定200件で一覧が打ち切られるとき、そのことを黙らせない。 */}
          {columnsTruncated ? (
            <p role="status" className="text-caption font-normal text-warning">
              コラムは全部で{num(columnsTotal)}本あります。一覧には新しい{num(columns.length)}本までを表示しています。それ以前のコラムはEC側でご確認ください。
            </p>
          ) : null}

          <section data-design="Table" data-design-node="nen-columns-table">
            {loading && columns.length === 0 ? (
              <ListState kind="loading" title="コラムを読み込んでいます" />
            ) : columns.length === 0 ? (
              <ListState kind="empty" title="まだコラムがありません" description="ECサイトでジャーナルを公開すると、ここに届きます。売らない配信です。ここで信用がたまると、売る配信が届きやすくなります。" action={<Button href="/nen-campaigns/columns/new" variant="primary">コラムを書く</Button>} />
            ) : shown.length === 0 ? (
              <ListState kind="empty" emptyPreset="readonly" title="条件に合うコラムはありません" description="検索や絞り込みを変えてみてください。" />
            ) : (
              <>
                <DataTable>
                  <thead>
                    <TableHeadRow>
                      <Th>コラム</Th>
                      <Th className="w-24">分類</Th>
                      <Th className="w-20">公開日</Th>
                      <Th className="w-40">LINE配信</Th>
                      <Th className="w-16" align="right">閲覧</Th>
                      {/* #707: 390px横スクロール時に操作列を右端へ留める */}
                      <Th className="w-28 sticky right-0 bg-surface-pearl" align="right"><span className="sr-only">操作</span></Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {visible.map((column) => {
                      const metric = metrics?.columns.find((candidate) => candidate.id === column.id)
                      const isSelected = column.id === selectedColumnId
                      return (
                        <Tr key={column.id} aria-selected={isSelected} className="aria-selected:bg-accent-soft">
                          <Td>
                            <span className="flex items-center gap-3">
                              {column.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element -- ECのコラム画像
                                <img src={column.imageUrl} alt="" className="h-9 w-14 shrink-0 rounded-mini object-cover" />
                              ) : (
                                <span aria-hidden="true" className="flex h-9 w-14 shrink-0 items-center justify-center rounded-mini bg-canvas-sunken text-ink-faint"><Newspaper size={16} /></span>
                              )}
                              <button type="button" onClick={() => onSelect(column.id)} className="min-w-0 text-left">
                                <span className="block truncate text-label font-semibold text-ink" title={column.title}>{column.title}</span>
                              </button>
                            </span>
                          </Td>
                          <Td><span className="text-label text-ink-secondary">{column.category || '—'}</span></Td>
                          <Td><span className="text-label tabular-nums text-ink-secondary">{jstShortDate(column.publishedAt)}</span></Td>
                          <Td>{columnDeliveryBadge(column)}</Td>
                          <Td align="right"><span className="text-label tabular-nums text-ink" title={metric?.articleOpened.reason ?? undefined}>{num(metric?.articleOpened.value ?? null)}</span></Td>
                          <Td align="right" className="sticky right-0 bg-canvas">
                            {isSelected ? (
                              <span className="text-label font-semibold text-ink-faint">選択中</span>
                            ) : (
                              <button type="button" onClick={() => onSelect(column.id)} className="text-label font-semibold text-action">
                                {column.deliveryStatus === 'sent' ? 'もう一度送る' : column.deliveryStatus === 'draft' ? '選ぶ' : '予約を見る'}
                              </button>
                            )}
                          </Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </DataTable>
                {pageCount > 1 ? <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} /> : null}
              </>
            )}
          </section>
        </div>

        <aside data-design="Panel" data-design-node="nen-column-panel" className="flex flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-card border border-hairline bg-canvas p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-label font-bold text-ink">LINEに届くカード</h2>
              <span className="text-micro text-ink-faint">選んだコラムから自動で作られます</span>
            </div>
            {selected ? (
              <>
                <ColumnLinePreview column={selected} introText={introDraft} buttonLabel={buttonLabel} />
                <p className="text-micro text-ink-faint">差し込み：{'{{pet_name}}'} → {COLUMN_PET_NAME_FALLBACK}（コラムは全員に同じ文面で届きます）</p>
                <label className="flex flex-col gap-1 text-caption font-semibold text-ink">
                  カードの前に送る紹介文
                  <TextArea rows={4} maxLength={1500} value={introDraft} onChange={(event) => onIntroChange(event.target.value)} />
                </label>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-micro text-ink-faint">{introDraft.length}／1500文字</span>
                  <Button type="button" size="field" disabled={!introDirty || savingColumnId === selected.id || !introDraft.trim()} onClick={() => onSaveIntro(selected)}>{savingColumnId === selected.id ? '保存中…' : '紹介文を保存'}</Button>
                </div>
              </>
            ) : (
              <ListState kind="empty" emptyPreset="readonly" title="コラムを選んでください" description="左の一覧から選ぶと、LINEに届く見え方をここで確認できます。" />
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-card border border-hairline bg-canvas p-4">
            <h2 className="text-label font-bold text-ink">誰に・いつ送るか</h2>
            {/* #934 N-295: コラム配信の停止・再開は自動配信タブに出ないため、ここに置く。 */}
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                {columnEnabled ? <StatusBadge tone="success" size="compact">配信中</StatusBadge> : <StatusBadge tone="warning" size="compact">停止中</StatusBadge>}
                <span className="text-micro font-normal text-ink-faint">コラム配信の決めごと</span>
              </span>
              {columnSetting ? (
                <Button type="button" size="field" disabled={savingCampaignKey === columnSetting.campaignKey} onClick={() => onToggleCampaign(columnSetting)}>
                  {columnEnabled ? '止める' : '動かす'}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col gap-1 text-caption font-semibold text-ink">
              送る相手
              <span className="rounded-control border border-hairline bg-canvas-sunken px-3 py-2 text-label font-normal text-ink">
                {selected
                  ? selected.targetMode === 'tag' ? `タグで絞り込み（${audienceCount == null ? '—' : num(audienceCount)}人）` : `友だち 全員（${audienceCount == null ? '—' : num(audienceCount)}人）`
                  : '—'}
              </span>
              <span className="text-micro font-normal text-ink-faint">送る相手はコラムを作るときに決めます。友だち解除・ブロックの人には送られません。</span>
            </div>
            <div className="flex flex-col gap-2 text-caption font-semibold text-ink">
              送る時
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="送る時">
                <Button type="button" role="radio" aria-checked={plan.when === 'now'} variant={plan.when === 'now' ? 'primary' : 'secondary'} onClick={() => onPlanChange({ ...plan, when: 'now' })}>今すぐ</Button>
                <Button type="button" role="radio" aria-checked={plan.when === 'schedule'} variant={plan.when === 'schedule' ? 'primary' : 'secondary'} onClick={() => onPlanChange({ ...plan, when: 'schedule' })}>日時を予約</Button>
              </div>
              {plan.when === 'schedule' ? (
                <>
                  <TextField type="datetime-local" aria-label="予約日時（日本時間）" value={plan.scheduledAt} invalid={scheduleInvalid} onChange={(event) => onPlanChange({ ...plan, scheduledAt: event.target.value })} />
                  {schedulePast ? (
                    <span className="text-micro font-normal text-danger">予約日時が過去になっています。いまより先の日時を選んでください。</span>
                  ) : null}
                </>
              ) : null}
            </div>
            <p className="text-micro text-ink-faint">
              {selected && audienceCount != null ? `送信数 約${num(audienceCount)}通。` : ''}
              {columnEnabled ? '' : 'コラムの配信が停止中のため、いまは送れません。上の「動かす」で再開できます。'}
            </p>
            {selected ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="field" onClick={() => onDuplicate(selected)}>同じ形で書く</Button>
                <Button href="/nen-campaigns/columns/new" size="field">コラムを書く</Button>
              </div>
            ) : null}
          </section>
        </aside>
      </div>

      {/* 操作の結果は、押した場所（下部追従バー）のすぐ上に出す。画面の上に出しても見えない。 */}
      {notice ? <NoteBar tone={notice.tone === 'success' ? 'info' : 'danger'}>{notice.text}</NoteBar> : null}
      <StickyBar
        status={planLabel}
        actions={(
          <>
            <TestRecipientPicker friends={friends} value={testFriendId} onChange={onTestFriendChange} accountId={accountId} />
            <Button type="button" disabled={!selected || !testFriendId || testing !== null} onClick={() => selected && onTest(selected)}>{selected && testing === selected.id ? '送信中…' : '自分にテスト送信'}</Button>
            <Button type="button" variant="primary" disabled={!selected || !columnEnabled || scheduleInvalid} onClick={() => selected && setConfirmDeliver({ column: selected, scheduledAt: scheduledIso ?? undefined })}>
              {plan.when === 'now' ? 'この内容で送る' : 'この内容で予約する'}
            </Button>
          </>
        )}
      />

      <ConfirmDialog
        open={confirmDeliver !== null}
        title={confirmDeliver?.scheduledAt
          ? `「${confirmDeliver.column.title}」を配信予約しますか？`
          : `「${confirmDeliver?.column.title ?? ''}」を今すぐ配信しますか？`}
        description={confirmDeliver?.scheduledAt
          ? `${jstLongDateTime(confirmDeliver.scheduledAt)}（日本時間）に、${audienceCount == null ? '対象' : `約${num(audienceCount)}人`}の友だちへ送ります。`
          : `すぐに配信待ちに入り、${audienceCount == null ? '対象' : `約${num(audienceCount)}人`}の友だちへ送られます。`}
        confirmLabel={confirmDeliver?.scheduledAt ? '予約する' : '送る'}
        onConfirm={() => { if (confirmDeliver) onDeliver(confirmDeliver.column, confirmDeliver.scheduledAt); setConfirmDeliver(null) }}
        onCancel={() => setConfirmDeliver(null)}
      />
    </>
  )
}

/* ───────────── 送った履歴 ───────────── */

type HistoryFilter = 'all' | 'sent' | 'pending' | 'failed' | 'skipped'

function HistoryPanel({ deliveryList, detail, loading, onShowDetail, onRetry, onChangeView }: {
  deliveryList: NenDeliveryList | null
  detail: NenDeliveryDetail | null
  loading: boolean
  onShowDetail: (id: string) => void
  onRetry: (id: string, version: number, reason: string) => void
  onChangeView: (status?: string, cursor?: string, q?: string) => void
}) {
  const [draft, setDraft] = useState('')
  // 確定した検索語。絞り込みチップやページ送りにも引き継ぐ（入力途中の文字は渡さない）。
  const [appliedQuery, setAppliedQuery] = useState('')
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [retryReasons, setRetryReasons] = useState<Record<string, string>>({})
  // 検索はサーバー側で履歴全体へ効く。画面に読み込んでいる20件だけの絞り込みではない。
  const shown = useMemo(() => deliveryList?.deliveries ?? [], [deliveryList])
  const summary = deliveryList?.summary
  const cursor = Number(deliveryList?.pagination.cursor ?? 0)
  const limit = deliveryList?.pagination.limit ?? 20
  const rangeLabel = deliveryList?.range ? `この${deliveryList.range.days}日（${jstShortDate(deliveryList.range.from)}〜${jstShortDate(deliveryList.range.to)}）` : 'この30日'
  const undeliveredDetail = summary
    ? [`ブロック ${summary.unmetReasons?.blocked ?? 0}・退会 ${summary.unmetReasons?.unfollowed ?? 0}・その他 ${summary.unmetReasons?.other ?? 0}`, skippedReasonsDetail(summary.skippedReasons as Record<string, number> | undefined)].filter(Boolean).join(' ／ ')
    : null

  /*
   * 絞り込みで0件と、まだ履歴そのものが無いのは別のこと（#635）。
   * 「まだありません」のままだと、検索して0件でも「そもそも無い」と
   * 読めてしまう。解除は検索語・状態チップ・ページをまとめて初期へ戻す。
   */
  const clearHistoryFilters = () => {
    setDraft('')
    setAppliedQuery('')
    setFilter('all')
    onChangeView(undefined, undefined, '')
  }

  return (
    <>
      <div data-design="Note" data-design-node="nen-history-note">
        <NoteBar tone="info">いつ・だれに・何を送ったかの記録です。届かなかったものもここで分かります。{undeliveredDetail ? ` ${undeliveredDetail}。` : ''}</NoteBar>
      </div>

      <div data-design="ListControls" data-design-node="nen-history-controls" className="flex flex-wrap items-center gap-3">
        <form
          className="min-w-64 flex-1"
          onSubmit={(event) => { event.preventDefault(); const q = draft.trim(); setAppliedQuery(q); onChangeView(deliveryViewStatus(filter), undefined, q) }}
        >
          <TextField aria-label="友だちの名前・配信の名前で検索" placeholder="友だちの名前・配信の名前で検索" value={draft} onChange={(event) => setDraft(event.target.value)} />
        </form>
        <span className="text-caption text-ink-faint">{rangeLabel}・送った日が新しい順</span>
      </div>
      {/* #727: チップに出ている数を押したら、その数だけ並ぶ。failed と skipped は
          どちらも溜まり続け運用者のやることが違うため別チップで単一状態ずつ絞る。
          「これから」は processing がごく短い一時状態でそこだけ見る場面がないため、
          チップは1つのまま pending,processing の複数状態で絞る。 */}
      <div className="flex flex-wrap gap-2">
        {([
          ['all', `すべて ${deliveryList?.pagination.total ?? '—'}`],
          ['sent', `送りました ${summary?.sent ?? '—'}`],
          ['pending', `これから ${summary ? summary.pending + summary.processing : '—'}`],
          ['failed', `届きませんでした ${summary?.failed ?? '—'}`],
          ['skipped', `送りませんでした ${summary?.skipped ?? '—'}`],
        ] as Array<[HistoryFilter, string]>).map(([value, label]) => (
          <FilterChip key={value} selected={filter === value} onChange={(selected) => { const next = selected ? value : 'all'; setFilter(next); onChangeView(deliveryViewStatus(next), undefined, appliedQuery) }}>{label}</FilterChip>
        ))}
      </div>

      <section data-design="Table" data-design-node="nen-history-table">
        {loading && !deliveryList ? (
          <ListState kind="loading" title="送った履歴を読み込んでいます" />
        ) : shown.length === 0 ? (
          filter !== 'all' || appliedQuery ? (
            <ListState
              kind="empty"
              emptyPreset="readonly"
              title="条件に合う履歴はありません"
              description="検索語や絞り込みを変えてください。"
              action={<Button variant="secondary" onClick={clearHistoryFilters}>検索と絞り込みを解除</Button>}
            />
          ) : (
            <ListState kind="empty" emptyPreset="readonly" title="送った履歴はまだありません" description="配信が予約されると、送信前からここに記録が並びます。" />
          )
        ) : (
          <DataTable>
            <thead>
              <TableHeadRow>
                <Th className="w-64">いつ・だれに</Th>
                <Th>配信</Th>
                <Th className="w-48">状態</Th>
                <Th className="w-36">きっかけ</Th>
                <Th className="w-20" align="right">開封</Th>
                {/* #707: 390px横スクロール時に操作列を右端へ留める */}
                <Th className="w-24 sticky right-0 bg-surface-pearl" align="right"><span className="sr-only">操作</span></Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {shown.map((delivery) => (
                <Fragment key={delivery.id}>
                  <Tr>
                    <Td>
                      <span className="block text-label font-semibold text-ink">{formatNenJobDateTime(delivery.sentAt || delivery.scheduledAt)}</span>
                      <span className="block truncate text-micro text-ink-faint" title={`${delivery.friendName || '名前未取得'}・${delivery.lineAccountName}`}>{delivery.friendName || '名前未取得'}・{delivery.lineAccountName}</span>
                    </Td>
                    <Td><span className="text-label text-ink">{delivery.label}</span></Td>
                    <Td>
                      <span className="block text-label font-semibold text-ink">{statusLabel[delivery.status] ?? '状態を確認できません'}</span>
                      {delivery.unmetReason ? <span className="block text-micro text-danger">{delivery.unmetReason}</span> : null}
                    </Td>
                    <Td><span className="text-label text-ink-secondary">{deliveryTriggerLabel(delivery.campaignKey)}</span></Td>
                    <Td align="right"><span className="text-label text-ink-faint" title={delivery.reaction.reason}>取得不可</span></Td>
                    <Td align="right" className="sticky right-0 bg-canvas">
                      <button type="button" onClick={() => onShowDetail(delivery.id)} className="text-label font-semibold text-action">{detail?.id === delivery.id ? '閉じる' : '中身を見る'}</button>
                    </Td>
                  </Tr>
                  {detail?.id === delivery.id ? (
                    <tr>
                      <td colSpan={6} className="border-t border-hairline bg-canvas-sunken p-4">
                        <div className="grid gap-4 lg:grid-cols-3">
                          <div className="lg:col-span-2">
                            <p className="text-micro font-bold text-ink-faint">{detail.trigger}</p>
                            <h3 className="mt-1 text-label font-bold text-ink">{detail.content.title || detail.label}</h3>
                            <p className="mt-2 whitespace-pre-wrap text-caption leading-6 text-ink-secondary">{detail.content.bodyText || detail.content.reason}</p>
                            {detail.content.buttonLabel ? <p className="mt-2 text-caption font-bold text-accent-deep">{detail.content.buttonLabel}</p> : null}
                            {/* IDEA-21: 案内の送り先を友だち詳細へつなぐ。注文・定期便の状況はそこで追える。 */}
                            <p className="mt-2">
                              <Link href={`/friends/detail?id=${encodeURIComponent(delivery.friendId)}`} className="text-micro font-semibold text-action hover:underline">
                                {delivery.friendName || 'この友だち'}の記録を見る
                              </Link>
                            </p>
                          </div>
                          {canRetryDelivery(delivery) ? (
                            <div className="flex flex-col gap-2">
                              <label className="flex flex-col gap-1 text-caption font-bold text-ink">
                                再送する理由（500文字まで）
                                <TextArea value={retryReasons[delivery.id] ?? ''} onChange={(event) => setRetryReasons((current) => ({ ...current, [delivery.id]: event.target.value }))} rows={3} maxLength={500} />
                              </label>
                              <Button type="button" variant="primary" disabled={!(retryReasons[delivery.id] ?? '').trim()} onClick={() => onRetry(delivery.id, delivery.version, retryReasons[delivery.id] ?? '')}>再送待ちへ戻す</Button>
                            </div>
                          ) : delivery.status === 'skipped' ? (
                            <p className="text-micro text-ink-faint">{skippedNoRetryNote[delivery.unmetReasonCode ?? ''] ?? 'この記録は再送できません。'}</p>
                          ) : (
                            <p className="text-micro text-ink-faint">再送は最大回数まで失敗した記録と、直せる理由で止まった記録だけ行えます。</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ListRange label="記録" total={deliveryList?.pagination.total ?? 0} first={shown.length === 0 ? 0 : cursor + 1} last={shown.length === 0 ? 0 : cursor + shown.length} />
        {deliveryList && (cursor > 0 || deliveryList.pagination.nextCursor) ? (
          <div className="flex gap-2" aria-label="送った履歴のページ送り">
            <Button type="button" disabled={cursor === 0} onClick={() => onChangeView(deliveryViewStatus(filter), String(Math.max(0, cursor - limit)), appliedQuery)}>前へ</Button>
            <Button type="button" disabled={!deliveryList.pagination.nextCursor} onClick={() => onChangeView(deliveryViewStatus(filter), deliveryList.pagination.nextCursor ?? undefined, appliedQuery)}>次へ</Button>
          </div>
        ) : null}
      </div>
    </>
  )
}

// #727: チップの選択を配信状態の絞り込み文字列へ変える。「これから」だけ複数状態。
function deliveryViewStatus(filter: HistoryFilter): string | undefined {
  if (filter === 'all') return undefined
  if (filter === 'pending') return 'pending,processing'
  return filter
}

function deliveryTriggerLabel(campaignKey: string) {
  const labels: Record<string, string> = {
    order_confirmed: '注文が確定', shipping_confirmed: '発送を登録', arrival_check: '発送後の到着確認',
    review_request: '発送後の口コミ依頼', cross_sell: '発送後のご案内', column: 'コラムの予約', birthday_coupon: 'ペットの誕生日',
  }
  return labels[campaignKey] ?? '配信の決めごと'
}
