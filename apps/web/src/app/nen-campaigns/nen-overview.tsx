'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SearchField from '@/components/shared/search-field'
import SelectField from '@/components/shared/select-field'
import { FeatureLinkCard } from '@/components/shared/side-cards'
import SummaryCard from '@/components/shared/summary-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import type {
  NenCampaignSetting,
  NenColumn,
  NenColumnMetrics,
  NenDeliveryDetail,
  NenDeliveryList,
  NenFlowMetrics,
  NenPetMetrics,
  NenPetProfile,
} from '@/lib/api'
import { formatCampaignContent, formatCampaignTiming, formatNenJobDateTime } from './campaign-display'

export type NenTab = 'flow' | 'columns' | 'pets' | 'history'

export type NenJob = {
  id: string
  campaignKey: string
  label: string
  friendName: string | null
  scheduledAt: string
  status: string
  attempts: number
  lastError: string | null
  sentAt: string | null
  triggerLabel?: string | null
  reactionLabel?: string | null
  lineAccountName?: string | null
}

export type NenCoupon = {
  isEnabled: boolean
  codePrefix: string
  benefitLabel: string
  discountAmount: number
  validityDays: number
}

const statusLabel: Record<string, string> = {
  pending: 'これから送ります',
  processing: '送信中',
  sent: '送りました',
  skipped: '対象外',
  failed: '届きませんでした',
  cancelled: '取り消し済み',
}

const columnStatusLabel: Record<NenColumn['deliveryStatus'], string> = {
  draft: '下書き',
  scheduled: '予約ずみ',
  queued: '配信待ち',
  sent: '出したもの',
}

const categoryLabel: Record<NenCampaignSetting['category'], string> = {
  transactional: '購入通知',
  follow_up: '購入後フォロー',
  column: 'NENコラム',
  birthday: '記念日',
}

function Kpis({
  tab,
  flowMetrics,
  columnMetrics,
  petMetrics,
  deliveryList,
}: {
  tab: NenTab
  flowMetrics: NenFlowMetrics | null
  columnMetrics: NenColumnMetrics | null
  petMetrics: NenPetMetrics | null
  deliveryList: NenDeliveryList | null
}) {
  const topColumn = columnMetrics ? [...columnMetrics.columns]
    .filter((column) => column.articleOpened.state === 'available')
    .sort((a, b) => (b.articleOpened.value ?? 0) - (a.articleOpened.value ?? 0))[0] : undefined
  const nextColumn = columnMetrics ? [...columnMetrics.columns]
    .filter((column) => column.deliveryAt && ['scheduled', 'queued'].includes(column.deliveryStatus))
    .sort((a, b) => String(a.deliveryAt).localeCompare(String(b.deliveryAt)))[0] : undefined
  const petRegistrationRate = petMetrics && petMetrics.summary.friends > 0
    ? Math.round((petMetrics.summary.pets / petMetrics.summary.friends) * 1000) / 10
    : null
  const nextDelivery = [...(deliveryList?.deliveries ?? [])]
    .filter((delivery) => ['pending', 'processing'].includes(delivery.status))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0]
  const cards = tab === 'flow'
    ? [
        { title: '動いている配信', value: flowMetrics?.summary.active ?? null, unit: 'つ', detail: `止めているもの ${flowMetrics?.summary.paused ?? '—'}つ` },
        { title: 'この30日に送った', value: flowMetrics?.summary.sent ?? null, unit: '通', detail: `予定 ${flowMetrics?.summary.planned ?? '—'}通` },
        { title: '到達率・クリック率', value: null, unit: '%', detail: flowMetrics?.flows[0]?.openRate.reason ?? 'LINEから個人開封を取得できません' },
        { title: 'この配信からの成果', value: flowMetrics?.summary.associatedConversionAmount ?? null, unit: '円', detail: `送信後7日以内 ${flowMetrics?.summary.associatedConversions ?? '—'}件` },
      ]
    : tab === 'columns'
      ? [
          { title: '出したコラム', value: columnMetrics?.summary.sent ?? null, unit: '本', detail: `下書き ${columnMetrics?.summary.drafts ?? '—'}本` },
          { title: '次に出すもの', value: columnMetrics?.summary.scheduled ?? null, unit: '本', detail: nextColumn ? `${columnMetricDate(nextColumn.deliveryAt)} ／ ${nextColumn.title}` : '予約ずみのコラムはありません' },
          { title: 'いちばん読まれた', value: topColumn?.articleOpened.value ?? null, unit: '人', detail: topColumn?.title ?? '計測できる記事がありません' },
          { title: 'コラムからの成果', value: columnMetrics?.summary.associatedConversionAmount ?? null, unit: '円', detail: `送信後7日以内 ${columnMetrics?.summary.associatedConversions ?? '—'}件` },
        ]
      : tab === 'pets'
        ? [
            { title: 'ペットの登録', value: petMetrics?.summary.pets ?? null, unit: '匹', detail: `友だち ${petMetrics?.summary.friends ?? '—'}人のうち ${petRegistrationRate ?? '—'}%` },
            { title: '今月 誕生日の子', value: petMetrics?.summary.birthdayThisMonth ?? null, unit: '匹', detail: `誕生日未登録 ${petMetrics?.summary.birthdayMissing ?? '—'}匹` },
            { title: '誕生日配信の到達率', value: typeof petMetrics?.summary.birthdayReachRate === 'number' ? Math.round(petMetrics.summary.birthdayReachRate * 1000) / 10 : null, unit: '%', detail: 'ふつうの配信の 2倍以上' },
            { title: '誕生日配信のクリック率', value: typeof petMetrics?.summary.birthdayClickRate === 'number' ? Math.round(petMetrics.summary.birthdayClickRate * 1000) / 10 : null, unit: '%', detail: `${petMetrics?.summary.coupons.used ?? '—'}匹ぶんが使われました` },
          ]
        : [
            { title: '送りました', value: deliveryList?.summary.sent ?? null, unit: '通', detail: deliveryList ? `1日あたり ${Math.round((deliveryList.summary.sent / deliveryList.range.days) * 10) / 10}通` : 'この30日の合計' },
            { title: 'これから送る', value: deliveryList ? deliveryList.summary.pending + deliveryList.summary.processing : null, unit: '通', detail: nextDelivery ? `いちばん近いのは ${formatNenJobDateTime(nextDelivery.scheduledAt)}` : '送信待ちはありません' },
            { title: '届かなかった', value: deliveryList ? deliveryList.summary.failed + deliveryList.summary.skipped : null, unit: '通', detail: `ブロック ${deliveryList?.summary.unmetReasons?.blocked ?? 0}・退会 ${deliveryList?.summary.unmetReasons?.unfollowed ?? 0}・その他 ${deliveryList?.summary.unmetReasons?.other ?? 0}` },
            { title: 'やり直しが必要', value: deliveryList?.summary.retryRequired ?? null, unit: '通', detail: '最大回数まで失敗した記録' },
          ]

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-design="KPIs">
      {cards.map((card) => <SummaryCard key={card.title} {...card} variant="v6" />)}
    </div>
  )
}

export function NenOverview({
  tab,
  topAction,
  onTabChange,
  settings,
  columns,
  pets,
  flowMetrics,
  columnMetrics,
  petMetrics,
  deliveryList,
  deliveryDetail,
  coupon,
  friends,
  testFriendId,
  previewCampaignKey,
  previewColumnId,
  editingColumnId,
  saving,
  testing,
  savingColumnId,
  petDraft,
  notice,
  onTestFriendChange,
  onPreviewCampaign,
  onPreviewColumn,
  onEditColumn,
  onUpdateColumn,
  onSaveColumn,
  onDeliverColumn,
  onDuplicateColumn,
  onTestColumn,
  onToggleSetting,
  onTestSend,
  onPetDraftChange,
  onAddPet,
  onDeletePet,
  onCouponChange,
  onSaveCoupon,
  onShowDelivery,
  onRetryDelivery,
  onChangeDeliveryView,
  renderCampaignPreview,
  renderColumnPreview,
}: {
  tab: NenTab
  topAction: ReactNode
  onTabChange: (tab: NenTab) => void
  settings: NenCampaignSetting[]
  columns: NenColumn[]
  pets: NenPetProfile[]
  flowMetrics: NenFlowMetrics | null
  columnMetrics: NenColumnMetrics | null
  petMetrics: NenPetMetrics | null
  deliveryList: NenDeliveryList | null
  deliveryDetail: NenDeliveryDetail | null
  coupon: NenCoupon
  friends: Array<{ id: string; displayName: string | null }>
  testFriendId: string
  previewCampaignKey: string | null
  previewColumnId: string | null
  editingColumnId: string | null
  saving: string | null
  testing: string | null
  savingColumnId: string | null
  petDraft: { friendId: string; name: string; animalType: string; gender: string; birthday: string }
  notice: { tone: 'success' | 'error'; text: string } | null
  onTestFriendChange: (id: string) => void
  onPreviewCampaign: (key: string | null) => void
  onPreviewColumn: (id: string | null) => void
  onEditColumn: (id: string | null) => void
  onUpdateColumn: (id: string, text: string) => void
  onSaveColumn: (column: NenColumn) => void
  onDeliverColumn: (column: NenColumn, scheduledAt?: string) => void
  onDuplicateColumn: (column: NenColumn) => void
  onTestColumn: (column: NenColumn) => void
  onToggleSetting: (setting: NenCampaignSetting) => void
  onTestSend: (setting: NenCampaignSetting) => void
  onPetDraftChange: (draft: { friendId: string; name: string; animalType: string; gender: string; birthday: string }) => void
  onAddPet: () => void
  onDeletePet: (pet: NenPetProfile) => void
  onCouponChange: (coupon: NenCoupon) => void
  onSaveCoupon: () => void
  onShowDelivery: (id: string) => void
  onRetryDelivery: (id: string, version: number, reason: string) => void
  onChangeDeliveryView: (status?: string, cursor?: string) => void
  renderCampaignPreview: (setting: NenCampaignSetting) => ReactNode
  renderColumnPreview: (column: NenColumn) => ReactNode
}) {
  return (
    <main className="mx-auto flex w-full flex-col gap-4 px-4 pb-8 sm:px-6" style={{ maxWidth: 1600 }} data-design-node={tab === 'flow' ? 'VLMGH' : tab === 'columns' ? 'DEX0k' : tab === 'pets' ? 'q4lajm' : 'WeXbL'}>
      <div data-design="Crumb" className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <nav className="text-ink-faint" aria-label="パンくず">
          <span className="text-action font-semibold">専用機能</span>
          <span className="mx-2">›</span>
          <span>NEN配信</span>
        </nav>
        {topAction}
      </div>
      <Tabs
        items={[
          { label: '配信フロー', count: settings.length, current: tab === 'flow', onClick: () => onTabChange('flow') },
          { label: 'NENコラム', count: columns.length, current: tab === 'columns', onClick: () => onTabChange('columns') },
          { label: 'ペット・記念日', current: tab === 'pets', onClick: () => onTabChange('pets') },
          { label: '配信履歴', current: tab === 'history', onClick: () => onTabChange('history') },
        ]}
      />
      <Kpis tab={tab} flowMetrics={flowMetrics} columnMetrics={columnMetrics} petMetrics={petMetrics} deliveryList={deliveryList} />
      {notice ? <NoteBar tone={notice.tone === 'success' ? 'info' : 'danger'}>{notice.text}</NoteBar> : null}
      {tab === 'flow' ? (
        <FlowPanel
          settings={settings}
          friends={friends}
          testFriendId={testFriendId}
          previewCampaignKey={previewCampaignKey}
          saving={saving}
          testing={testing}
          onTestFriendChange={onTestFriendChange}
          onPreview={onPreviewCampaign}
          onToggle={onToggleSetting}
          onTestSend={onTestSend}
          renderPreview={renderCampaignPreview}
          metrics={flowMetrics}
        />
      ) : null}
      {tab === 'columns' ? (
        <ColumnsPanel
          columns={columns}
          previewColumnId={previewColumnId}
          editingColumnId={editingColumnId}
          savingColumnId={savingColumnId}
          onPreview={onPreviewColumn}
          onEdit={onEditColumn}
          onUpdate={onUpdateColumn}
          onSave={onSaveColumn}
          onDeliver={onDeliverColumn}
          onDuplicate={onDuplicateColumn}
          onTest={onTestColumn}
          onShowHistory={() => onTabChange('history')}
          renderPreview={renderColumnPreview}
          metrics={columnMetrics}
        />
      ) : null}
      {tab === 'pets' ? (
        <PetsPanel
          pets={pets}
          coupon={coupon}
          friends={friends}
          petDraft={petDraft}
          onPetDraftChange={onPetDraftChange}
          onAddPet={onAddPet}
          onDeletePet={onDeletePet}
          onCouponChange={onCouponChange}
          onSaveCoupon={onSaveCoupon}
          metrics={petMetrics}
        />
      ) : null}
      {tab === 'history' ? <HistoryPanel deliveryList={deliveryList} detail={deliveryDetail} onShowDetail={onShowDelivery} onRetry={onRetryDelivery} onChangeView={onChangeDeliveryView} /> : null}
    </main>
  )
}

function FlowPanel({
  settings,
  metrics,
  friends,
  testFriendId,
  previewCampaignKey,
  saving,
  testing,
  onTestFriendChange,
  onPreview,
  onToggle,
  onTestSend,
  renderPreview,
}: {
  settings: NenCampaignSetting[]
  metrics: NenFlowMetrics | null
  friends: Array<{ id: string; displayName: string | null }>
  testFriendId: string
  previewCampaignKey: string | null
  saving: string | null
  testing: string | null
  onTestFriendChange: (id: string) => void
  onPreview: (key: string | null) => void
  onToggle: (setting: NenCampaignSetting) => void
  onTestSend: (setting: NenCampaignSetting) => void
  renderPreview: (setting: NenCampaignSetting) => ReactNode
}) {
  const deliverySettings = settings.filter((setting) => setting.category === 'transactional' || setting.category === 'follow_up')
  const flow = [
    ['order_confirmed', '注文が確定', 'すぐ', '注文ありがとうございます'],
    ['shipping_confirmed', '発送しました', '当日', 'お荷物の追跡番号'],
    ['arrival_check', '届きました', '到着の翌日', '使い方のご案内'],
    ['care_check', '3日目', '3日後', '困っていませんか'],
    ['review_request', '7日目', '7日後', '口コミのお願い'],
    ['cross_sell', '30日目', '30日後', 'そろそろ無くなるころ'],
    ['birthday_coupon', '記念日', '毎年', 'お誕生日クーポン'],
  ]
  return (
    <>
      <NoteBar>買っていただいた方に、注文からの日数や記念日に合わせて自動で送る配信です。もとになる注文は「EC連携」から来ます。</NoteBar>
      <section className="rounded-v6-card border border-hairline bg-canvas p-4 shadow-v6-card">
        <h2 className="text-base font-bold text-ink">買っていただいてからの流れ</h2>
        <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
          {flow.map(([campaignKey, title, when, message]) => {
            const compatibleKeys = campaignKey === 'order_confirmed' ? ['order_confirmed', 'order_thanks'] : campaignKey === 'shipping_confirmed' ? ['shipping_confirmed', 'shipping_notice'] : [campaignKey]
            const active = settings.find((setting) => compatibleKeys.includes(setting.campaignKey))?.isEnabled === true
            return (
              <div key={title} className="relative text-center">
                <span className={active ? 'mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-v6-action text-sm font-bold text-on-accent' : 'mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted text-sm font-bold text-ink-faint'}>{active ? '✓' : 'Ⅱ'}</span>
                <p className="mt-2 text-sm font-bold text-ink">{title}</p>
                <p className="mt-1 text-xs text-ink-faint">{when}</p>
                <p className="mt-2 text-xs leading-5 text-ink-secondary">{message}</p>
              </div>
            )
          })}
        </div>
      </section>
      <section className="overflow-hidden rounded-v6-card border border-hairline bg-canvas shadow-v6-card">
        {deliverySettings.length === 0 ? (
          <ListState kind="empty" title="配信フローはまだありません" description="EC連携から注文の流れを接続すると、ここに配信が並びます。" />
        ) : (
          <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
            <thead className="bg-surface-muted text-left text-xs text-ink-faint"><TableHeadRow><Th style={{ width: '26%' }}>配信</Th><Th style={{ width: '16%' }}>いつ送るか</Th><Th style={{ width: '17%' }}>中身</Th><Th style={{ width: '14%' }}>この30日</Th><Th style={{ width: '12%' }}>到達率・クリック率</Th><Th style={{ width: '15%' }}>操作</Th></TableHeadRow></thead>
            <tbody>
              {deliverySettings.map((setting) => {
                const metricKeys = setting.campaignKey === 'order_thanks' || setting.campaignKey === 'order_confirmed'
                  ? ['order_thanks', 'order_confirmed']
                  : setting.campaignKey === 'shipping_notice' || setting.campaignKey === 'shipping_confirmed'
                    ? ['shipping_notice', 'shipping_confirmed']
                    : [setting.campaignKey]
                const metric = metrics?.flows.find((candidate) => metricKeys.includes(candidate.campaignKey))
                return <Fragment key={setting.campaignKey}>
                  <tr className="border-t border-hairline">
                    <td className="px-3 py-3"><p className="font-bold text-ink">{setting.label}</p><p className="mt-1 text-xs text-ink-faint">{categoryLabel[setting.category]} ／ {formatCampaignTiming(setting)}</p></td>
                    <td className="px-3 py-3 text-ink-secondary">{formatCampaignTiming(setting)}</td>
                    <td className="px-3 py-3 text-ink-secondary">{formatCampaignContent(setting)}</td>
                    <td className="px-3 py-3 text-ink-secondary"><p className="font-semibold text-ink">{metric?.sent.toLocaleString('ja-JP') ?? '—'}通</p><p className="mt-1 text-xs text-ink-faint">予定 {metric?.planned.toLocaleString('ja-JP') ?? '—'}通</p></td>
                    <td className="px-3 py-3 text-ink-secondary"><p className="font-semibold text-ink" title={metric?.openRate.reason}>到達・クリックはLINE集計で確認</p><p className="mt-1 text-xs text-ink-faint">関連成果 {metric?.associatedConversions.toLocaleString('ja-JP') ?? '—'}件 ／ {metric?.associatedConversionAmount?.toLocaleString('ja-JP') ?? '—'}円</p></td>
                    <td className="px-3 py-3"><div className="flex flex-wrap justify-end gap-2"><Button onClick={() => onPreview(previewCampaignKey === setting.campaignKey ? null : setting.campaignKey)}>{previewCampaignKey === setting.campaignKey ? '閉じる' : '中身を見る'}</Button><Button onClick={() => onToggle(setting)} disabled={saving === setting.campaignKey}>{setting.isEnabled ? '止める' : '動かす'}</Button></div></td>
                  </tr>
                  {previewCampaignKey === setting.campaignKey ? <tr key={`${setting.campaignKey}-preview`}><td colSpan={6} className="border-t border-hairline p-3">{renderPreview(setting)}</td></tr> : null}
                </Fragment>
              })}
            </tbody>
          </table>
        )}
      </section>
      <section id="nen-test-send" className="rounded-v6-card border border-hairline bg-canvas p-4 shadow-v6-card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-sm font-bold text-ink">テスト送信</h2><p className="mt-1 text-xs text-ink-faint">同じLINEアカウントの確認用ユーザーだけに送ります。</p></div>
          <div className="flex flex-wrap items-end gap-2"><SelectField value={testFriendId} onChange={(event) => onTestFriendChange(event.target.value)} aria-label="テスト送信先" options={[{ value: '', label: '未設定' }, ...friends.map((friend) => ({ value: friend.id, label: friend.displayName || '名前未取得' }))]} /><Button variant="primary" disabled={!testFriendId || settings.length === 0 || testing !== null} onClick={() => settings[0] && onTestSend(settings[0])}>{testing ? '送信中...' : '最初の配信をテスト'}</Button></div>
        </div>
      </section>
    </>
  )
}

function ColumnsPanel({
  columns,
  metrics,
  previewColumnId,
  editingColumnId,
  savingColumnId,
  onPreview,
  onEdit,
  onUpdate,
  onSave,
  onDeliver,
  onDuplicate,
  onTest,
  onShowHistory,
  renderPreview,
}: {
  columns: NenColumn[]
  metrics: NenColumnMetrics | null
  previewColumnId: string | null
  editingColumnId: string | null
  savingColumnId: string | null
  onPreview: (id: string | null) => void
  onEdit: (id: string | null) => void
  onUpdate: (id: string, text: string) => void
  onSave: (column: NenColumn) => void
  onDeliver: (column: NenColumn, scheduledAt?: string) => void
  onDuplicate: (column: NenColumn) => void
  onTest: (column: NenColumn) => void
  onShowHistory: () => void
  renderPreview: (column: NenColumn) => ReactNode
}) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | NenColumn['deliveryStatus'] | 'unread'>('all')
  const [sort, setSort] = useState<'newest' | 'read'>('newest')
  const [page, setPage] = useState(1)
  const shown = columns.filter((column) => {
    const matchesSearch = `${column.title} ${column.excerpt} ${column.category ?? ''}`.toLowerCase().includes(search.toLowerCase())
    const metric = metrics?.columns.find((candidate) => candidate.id === column.id)
    return matchesSearch && (status === 'all' || (status === 'unread' ? (metric?.unread ?? 0) > 0 : column.deliveryStatus === status))
  }).sort((a, b) => sort === 'read'
    ? (metrics?.columns.find((column) => column.id === b.id)?.articleOpened.value ?? -1) - (metrics?.columns.find((column) => column.id === a.id)?.articleOpened.value ?? -1)
    : String(b.publishedAt ?? b.deliveryAt ?? '').localeCompare(String(a.publishedAt ?? a.deliveryAt ?? '')))
  const count = (value: NenColumn['deliveryStatus']) => columns.filter((column) => column.deliveryStatus === value).length
  const pageSize = 6
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visible = shown.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const first = shown.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const last = Math.min(currentPage * pageSize, shown.length)
  return (
    <>
      <NoteBar>コラムは売り込みをしない配信です。記事の正本は外部サイトで管理し、ここではLINEへ出す内容と日時を決めます。</NoteBar>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="w-full" style={{ maxWidth: 460 }}><SearchField value={search} onChange={(value) => { setSearch(value); setPage(1) }} onClear={() => { setSearch(''); setPage(1) }} placeholder="コラムの題名・概要で検索" /></div><div className="flex items-center gap-2"><span className="rounded-v6-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink-secondary">この{metrics?.range.days ?? 90}日</span><span className="rounded-v6-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink-secondary">6件表示</span><Button href="/nen-campaigns/columns/new" variant="primary">コラムを書く</Button></div></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-2">{[
        ['all', `すべて ${columns.length}`], ['sent', `出したもの ${count('sent')}`], ['draft', `下書き ${count('draft')}`], ['scheduled', `予約ずみ ${count('scheduled')}`],
        ...(metrics?.summary.unread === null ? [] : [['unread', `読まれていない ${metrics?.summary.unread ?? 0}`]]),
      ].map(([value, label]) => <FilterChip key={value} selected={status === value} onChange={(selected) => { setStatus(selected ? value as typeof status : 'all'); setPage(1) }}>{label}</FilterChip>)}</div><SelectField aria-label="コラムの並び順" value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setPage(1) }} options={[{ value: 'newest', label: '出した日が新しい順' }, { value: 'read', label: '読まれた数が多い順' }]} /></div>
      {shown.length === 0 ? (
        <ListState kind="empty" title={columns.length === 0 ? 'まだコラムがありません' : '条件に合うコラムはありません'} description="売らない配信です。ここで信用がたまると、売る配信が届きやすくなります。" action={<Button href="/nen-campaigns/columns/new" variant="primary">コラムを書く</Button>} />
      ) : (
        <section className="overflow-hidden rounded-v6-card border border-hairline bg-canvas shadow-v6-card">
          <table className="w-full table-fixed border-separate border-spacing-0 text-sm"><thead className="bg-surface-muted text-left text-xs text-ink-faint"><TableHeadRow><Th style={{ width: '27%' }}>コラム</Th><Th style={{ width: '11%' }}>出す日</Th><Th style={{ width: '11%' }}>届く人</Th><Th style={{ width: '11%' }}>読まれた</Th><Th style={{ width: '14%' }}>この記事からの成果</Th><Th style={{ width: '26%' }}>操作</Th></TableHeadRow></thead><tbody>
            {visible.map((column) => {
              const metric = metrics?.columns.find((candidate) => candidate.id === column.id)
              return <Fragment key={column.id}>
                <tr><td className="border-t border-hairline px-3 py-3"><p className="font-bold text-ink">{column.title}</p><p className="mt-1 text-xs text-ink-faint">{column.category || '分類なし'} ／ {column.excerpt || '概要なし'}</p></td><td className="border-t border-hairline px-3 py-3 text-ink-secondary">{columnDeliveryDate(column)}</td><td className="border-t border-hairline px-3 py-3 text-ink-secondary"><p className="font-semibold text-ink">{metric?.targeted.toLocaleString('ja-JP') ?? '—'}人</p><p className="mt-1 text-xs text-ink-faint">送信 {metric?.sent.toLocaleString('ja-JP') ?? '—'}人</p></td><td className="border-t border-hairline px-3 py-3 text-ink-secondary" title={metric?.articleOpened.reason ?? undefined}><p className="font-semibold text-ink">{metric?.articleOpened.value?.toLocaleString('ja-JP') ?? '—'}人</p><p className="mt-1 text-xs text-ink-faint">読了 {metric?.completionRate.value?.toLocaleString('ja-JP') ?? '—'}人</p></td><td className="border-t border-hairline px-3 py-3 text-ink-secondary"><p className="font-semibold text-ink">{metric?.associatedConversions.toLocaleString('ja-JP') ?? '—'}件</p><p className="mt-1 text-xs text-ink-faint">{typeof metric?.associatedConversionAmount === 'number' ? `${metric.associatedConversionAmount.toLocaleString('ja-JP')}円` : '—'}</p></td><td className="border-t border-hairline px-3 py-3"><div className="flex flex-wrap justify-end gap-2"><Button onClick={() => onPreview(previewColumnId === column.id ? null : column.id)}>中身を見る</Button><Button onClick={() => onDuplicate(column)}>同じ形で書く</Button><Button onClick={() => onTest(column)}>テスト送信</Button><Button onClick={onShowHistory}>配信結果</Button><Button onClick={() => onEdit(editingColumnId === column.id ? null : column.id)}>{editingColumnId === column.id ? '設定を閉じる' : '配信を設定'}</Button></div></td></tr>
                {previewColumnId === column.id ? <tr key={`${column.id}-preview`}><td colSpan={6} className="border-t border-hairline p-3">{renderPreview(column)}</td></tr> : null}
                {editingColumnId === column.id ? <tr key={`${column.id}-controls`}><td colSpan={6} className="border-t border-hairline bg-surface-muted px-3 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><Button onClick={() => onEdit(null)}>設定を閉じる</Button><Button onClick={() => onDeliver(column)} variant="primary">今すぐ配信予約</Button><input type="datetime-local" aria-label={`${column.title}の配信日時`} onChange={(event) => event.target.value && onDeliver(column, new Date(event.target.value).toISOString())} className="rounded-v6-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink" /></div><span className="text-xs font-semibold text-ink-secondary">{columnStatusLabel[column.deliveryStatus]}</span></div><div className="mt-3"><label className="text-sm font-bold text-ink">カードの前に送る紹介文<textarea value={column.introText} rows={5} maxLength={1500} onChange={(event) => onUpdate(column.id, event.target.value)} className="mt-2 block w-full rounded-v6-control border border-hairline bg-canvas px-3 py-2 text-sm leading-6 text-ink" /></label><div className="mt-2 flex justify-end"><Button variant="primary" disabled={savingColumnId === column.id} onClick={() => onSave(column)}>{savingColumnId === column.id ? '保存中...' : '配信文を保存'}</Button></div></div></td></tr> : null}
              </Fragment>
            })}
          </tbody></table>
        </section>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-faint">コラム {columns.length}本中 {first}〜{last}本を表示</p>
        {pageCount > 1 ? (
          <div className="flex items-center gap-2" aria-label="コラムのページ送り">
            <Button disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>前へ</Button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((value) => (
              <Button key={value} variant={value === currentPage ? 'primary' : 'secondary'} onClick={() => setPage(value)}>{value}</Button>
            ))}
            <Button disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>次へ</Button>
          </div>
        ) : null}
      </div>
    </>
  )
}

function PetsPanel({ pets, metrics, coupon, friends, petDraft, onPetDraftChange, onAddPet, onDeletePet, onCouponChange, onSaveCoupon }: {
  pets: NenPetProfile[]
  metrics: NenPetMetrics | null
  coupon: NenCoupon
  friends: Array<{ id: string; displayName: string | null }>
  petDraft: { friendId: string; name: string; animalType: string; gender: string; birthday: string }
  onPetDraftChange: (draft: { friendId: string; name: string; animalType: string; gender: string; birthday: string }) => void
  onAddPet: () => void
  onDeletePet: (pet: NenPetProfile) => void
  onCouponChange: (coupon: NenCoupon) => void
  onSaveCoupon: () => void
}) {
  const [previewPetId, setPreviewPetId] = useState<string | null>(null)
  const previewPet = pets.find((pet) => pet.id === previewPetId) ?? pets.find((pet) => pet.birthday) ?? pets[0]
  const missingBirthday = metrics?.summary.birthdayMissing
  return (
    <>
      <NoteBar>名前と誕生日は、答えてくれた方のペット情報だけを使います。誕生日は3日前の10:00に送ります。</NoteBar>
      <section className="rounded-v6-card border border-hairline bg-canvas p-4 shadow-v6-card"><h2 className="text-base font-bold text-ink">誕生日クーポンの決めごと</h2><div className="mt-4 grid gap-3 md:grid-cols-5"><ReadOnlyField label="いつ送るか" value="誕生日の3日前" /><ReadOnlyField label="時刻" value="10:00" /><NumberField label="割引の額（円）" value={coupon.discountAmount} onChange={(value) => onCouponChange({ ...coupon, discountAmount: value })} /><NumberField label="使える日数" value={coupon.validityDays} onChange={(value) => onCouponChange({ ...coupon, validityDays: value })} /><label className="text-xs font-bold text-ink">クーポンの頭の文字<input value={coupon.codePrefix} onChange={(event) => onCouponChange({ ...coupon, codePrefix: event.target.value.toUpperCase() })} className="mt-2 block w-full rounded-v6-control border border-hairline px-3 py-2 text-sm" /></label></div><div className="mt-3 flex justify-end"><Button variant="primary" onClick={onSaveCoupon}>設定を保存</Button></div></section>
      <div className="grid gap-4 xl:grid-cols-3">
        <section className="overflow-hidden rounded-v6-card border border-hairline bg-canvas shadow-v6-card xl:col-span-2"><div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline p-4"><div><h2 className="text-base font-bold text-ink">登録してもらったペット</h2><p className="mt-1 text-xs text-ink-faint">名前は配信に差し込まれます。まちがいがあると、そのまま届きます。</p></div><details><summary className="cursor-pointer text-sm font-bold text-v6-action">ペット情報を登録</summary><div className="mt-3 grid gap-2 sm:grid-cols-2"><SelectField value={petDraft.friendId} onChange={(event) => onPetDraftChange({ ...petDraft, friendId: event.target.value })} aria-label="ペット情報を登録するLINEユーザー" options={[{ value: '', label: 'LINEユーザーを選択' }, ...friends.map((friend) => ({ value: friend.id, label: friend.displayName || '名前未取得' }))]} /><input aria-label="ペットの名前" placeholder="ペットの名前" value={petDraft.name} onChange={(event) => onPetDraftChange({ ...petDraft, name: event.target.value })} className="rounded-v6-control border border-hairline px-3 py-2 text-sm" /><input aria-label="ペットの誕生日" type="date" value={petDraft.birthday} onChange={(event) => onPetDraftChange({ ...petDraft, birthday: event.target.value })} className="rounded-v6-control border border-hairline px-3 py-2 text-sm" /><Button variant="primary" onClick={onAddPet}>登録する</Button></div></details></div>{pets.length === 0 ? <ListState kind="empty" title="ペットはまだ登録されていません" description="聞きとりフォームか、この画面から登録してください。" /> : <table className="w-full table-fixed text-sm"><thead className="bg-surface-muted text-left text-xs text-ink-faint"><TableHeadRow><Th style={{ width: '23%' }}>ペット</Th><Th style={{ width: '17%' }}>飼い主</Th><Th style={{ width: '12%' }}>誕生日</Th><Th style={{ width: '22%' }}>次の配信・履歴</Th><Th style={{ width: '26%' }}>操作</Th></TableHeadRow></thead><tbody>{pets.map((pet) => { const metric = metrics?.pets.find((candidate) => candidate.id === pet.id); return <tr key={pet.id}><td className="border-t border-hairline px-3 py-3"><p className="font-bold text-ink">{pet.name}</p><p className="text-xs text-ink-faint">{petTypeLabel(pet.animalType)} ／ {metric?.breed || '品種未登録'}{petAge(pet.birthday)}</p></td><td className="border-t border-hairline px-3 py-3 text-ink-secondary">{metric?.ownerName || pet.ownerName || '名前未取得'}</td><td className="border-t border-hairline px-3 py-3 font-semibold text-ink">{petBirthdayLabel(pet.birthday)}</td><td className="border-t border-hairline px-3 py-3 text-ink-secondary"><p>{nextBirthdayLabel(pet.birthday)}</p><p className="mt-1 text-xs text-ink-faint">この30日の配信 {metric?.ownerDeliveryHistory.count ?? '—'}回</p></td><td className="border-t border-hairline px-3 py-3"><div className="flex flex-wrap justify-end gap-2"><Button onClick={() => { setPreviewPetId(pet.id); document.getElementById('nen-pet-preview')?.scrollIntoView({ behavior: 'smooth' }) }}>中身を見る</Button><Button href={`/friends/detail?id=${encodeURIComponent(pet.friendId)}`}>飼い主を見る</Button><Button onClick={() => onDeletePet(pet)}>登録を外す</Button></div></td></tr> })}</tbody></table>}</section>
        <aside id="nen-pet-preview" className="flex flex-col gap-4"><section className="rounded-v6-card border border-hairline bg-canvas p-4 shadow-v6-card"><h2 className="text-sm font-bold text-ink">{previewPet ? `${previewPet.name}にはこう届きます` : 'LINEプレビュー'}</h2><div className="mt-3 rounded-v6-card bg-info-bg p-4"><p className="text-center text-xs font-bold text-ink-secondary">LINEプレビュー</p><p className="mt-3 text-center text-xs font-bold text-ink-secondary">誕生日の3日前 10:00 に届きます</p><div className="mt-3 rounded-v6-control bg-canvas p-4"><p className="text-sm font-bold leading-6 text-ink">{previewPet ? `${previewPet.name}、もうすぐお誕生日ですね。おめでとうございます。` : 'ペットを登録すると文面を確認できます。'}</p><p className="mt-2 text-sm leading-6 text-ink-secondary">お祝いに{coupon.discountAmount.toLocaleString('ja-JP')}円ぶんのクーポンをお送りします。{coupon.validityDays}日間お使いいただけます。</p><p className="mt-3 rounded-v6-control bg-v6-action py-2 text-center text-sm font-bold text-on-accent">クーポンを受け取る</p></div></div></section><section className="rounded-v6-card border border-warning bg-warning-bg p-4"><h2 className="text-sm font-bold text-warning">手を入れたほうがよいところ</h2><p className="mt-3 text-sm font-bold text-warning">誕生日が入っていない子が {missingBirthday ?? '—'}匹</p><p className="mt-1 text-xs leading-5 text-ink-secondary">名前だけ登録されています。もう一度お願いを出せます。</p><p className="mt-3 text-sm font-bold text-warning">ペット未登録の友だちが {metrics?.summary.friendsWithoutPet ?? '—'}人</p><p className="mt-1 text-xs leading-5 text-ink-secondary">選択中のLINEアカウントの友だちと照合した人数です。</p></section><FeatureLinkCard items={[{ label: '回答フォーム', note: 'ペットのご紹介（聞きとり）', href: '/form-submissions' }, { label: '友だち属性', note: 'ペットの名前・誕生日', href: '/tags?tab=fields' }, { label: 'テンプレート', note: '誕生日クーポンの文面', href: '/templates' }, { label: 'コンバージョン', note: 'クーポンが使われた記録', href: '/conversions' }, { label: 'NEN配信', note: '記念日の配信', href: '/nen-campaigns' }]} /></aside>
      </div>
    </>
  )
}

function HistoryPanel({ deliveryList, detail, onShowDetail, onRetry, onChangeView }: {
  deliveryList: NenDeliveryList | null
  detail: NenDeliveryDetail | null
  onShowDetail: (id: string) => void
  onRetry: (id: string, version: number, reason: string) => void
  onChangeView: (status?: string, cursor?: string) => void
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'sent' | 'pending' | 'failed'>('all')
  const [retryReasons, setRetryReasons] = useState<Record<string, string>>({})
  const deliveries = deliveryList?.deliveries ?? []
  const shown = useMemo(() => deliveries.filter((delivery) => {
    const matches = `${delivery.friendName ?? ''} ${delivery.label}`.toLowerCase().includes(search.toLowerCase())
    return matches
  }), [deliveries, search])
  const summary = deliveryList?.summary
  const cursor = Number(deliveryList?.pagination.cursor ?? 0)
  const limit = deliveryList?.pagination.limit ?? 20
  const rangeLabel = deliveryList ? `この${deliveryList.range.days}日（${shortDate(deliveryList.range.from)}〜${shortDate(deliveryList.range.to)}）` : 'この30日'
  return (
    <>
      <NoteBar>いつ・だれに・何を送ったかの記録です。届かなかったものもここで分かります。</NoteBar>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="w-full" style={{ maxWidth: 460 }}><SearchField value={search} onChange={setSearch} onClear={() => setSearch('')} placeholder="友だちの名前・配信の名前で検索" /></div><div className="flex gap-2"><span className="rounded-v6-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink-secondary">{rangeLabel}</span><span className="rounded-v6-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink-secondary">{limit}件表示</span></div></div>
      <div className="flex flex-wrap gap-2">{[
        ['all', `すべて ${deliveryList?.pagination.total ?? '—'}`],
        ['sent', `送りました ${summary?.sent ?? '—'}`],
        ['pending', `これから ${summary ? summary.pending + summary.processing : '—'}`],
        ['failed', `届きませんでした ${summary ? summary.failed + summary.skipped : '—'}`],
      ].map(([value, label]) => <FilterChip key={value} selected={filter === value} onChange={(selected) => { const next = selected ? value as typeof filter : 'all'; setFilter(next); onChangeView(next === 'all' ? undefined : next === 'pending' ? 'pending' : next) }}>{label}</FilterChip>)}<span className="rounded-v6-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink-secondary">送った日が新しい順</span></div>
      {shown.length === 0 ? <ListState kind="empty" title="配信履歴はまだありません" description="配信が予約されると、送信前からここに記録が並びます。" /> : <section className="overflow-hidden rounded-v6-card border border-hairline bg-canvas shadow-v6-card"><table className="w-full table-fixed text-sm"><thead className="bg-surface-muted text-left text-xs text-ink-faint"><TableHeadRow><Th style={{ width: '24%' }}>いつ・だれに</Th><Th style={{ width: '18%' }}>配信</Th><Th style={{ width: '18%' }}>状態</Th><Th style={{ width: '15%' }}>きっかけ</Th><Th style={{ width: '12%' }}>到達率・クリック率</Th><Th style={{ width: '13%' }}>操作</Th></TableHeadRow></thead><tbody>{shown.map((delivery) => <Fragment key={delivery.id}><tr><td className="border-t border-hairline px-3 py-3"><p className="font-bold text-ink">{formatNenJobDateTime(delivery.sentAt || delivery.scheduledAt)} ／ {delivery.friendName || '名前未取得'}</p><p className="mt-1 text-xs text-ink-faint">{delivery.lineAccountName}</p></td><td className="border-t border-hairline px-3 py-3 text-ink">{delivery.label}</td><td className="border-t border-hairline px-3 py-3"><p className="font-semibold text-ink">{statusLabel[delivery.status] ?? '状態を確認できません'}</p>{delivery.unmetReason ? <p className="mt-1 text-xs text-danger">{delivery.unmetReason}</p> : null}</td><td className="border-t border-hairline px-3 py-3 text-xs text-ink-faint">{deliveryTriggerLabel(delivery.campaignKey)}</td><td className="border-t border-hairline px-3 py-3 text-xs text-ink-faint" title={delivery.reaction.reason}>取得不可</td><td className="border-t border-hairline px-3 py-3"><Button onClick={() => onShowDetail(delivery.id)}>{detail?.id === delivery.id ? '閉じる' : '中身を見る'}</Button></td></tr>{detail?.id === delivery.id ? <tr><td colSpan={6} className="border-t border-hairline bg-surface-muted p-4"><div className="grid gap-4 lg:grid-cols-3"><div className="lg:col-span-2"><p className="text-xs font-bold text-ink-faint">{detail.trigger}</p><h3 className="mt-1 font-bold text-ink">{detail.content.title || detail.label}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{detail.content.bodyText || detail.content.reason}</p>{detail.content.buttonLabel ? <p className="mt-2 text-sm font-bold text-v6-action">{detail.content.buttonLabel}</p> : null}</div>{delivery.status === 'failed' && delivery.attempts >= 5 ? <div><label className="text-xs font-bold text-ink">再送する理由<textarea value={retryReasons[delivery.id] ?? ''} onChange={(event) => setRetryReasons((current) => ({ ...current, [delivery.id]: event.target.value }))} rows={3} className="mt-2 block w-full rounded-v6-control border border-hairline bg-canvas px-3 py-2 text-sm" /></label><Button variant="primary" disabled={!(retryReasons[delivery.id] ?? '').trim()} onClick={() => onRetry(delivery.id, delivery.version, retryReasons[delivery.id] ?? '')}>再送待ちへ戻す</Button></div> : <p className="text-xs text-ink-faint">再送は最大回数まで失敗した記録だけ行えます。</p>}</div></td></tr> : null}</Fragment>)}</tbody></table></section>}
      <p className="text-xs text-ink-faint">記録 {deliveryList?.pagination.total ?? 0}件中 {shown.length === 0 ? 0 : cursor + 1}〜{cursor + shown.length}件を表示</p>
      {deliveryList && (cursor > 0 || deliveryList.pagination.nextCursor) ? <div className="flex justify-end gap-2" aria-label="配信履歴のページ送り"><Button disabled={cursor === 0} onClick={() => onChangeView(filter === 'all' ? undefined : filter, String(Math.max(0, cursor - limit)))}>前へ</Button><Button disabled={!deliveryList.pagination.nextCursor} onClick={() => onChangeView(filter === 'all' ? undefined : filter, deliveryList.pagination.nextCursor ?? undefined)}>次へ</Button></div> : null}
    </>
  )
}

function deliveryTriggerLabel(campaignKey: string) {
  const labels: Record<string, string> = {
    order_confirmed: '注文が確定', shipping_confirmed: '発送を登録', arrival_check: '発送後の到着確認',
    review_request: '発送後の口コミ依頼', cross_sell: '発送後のご案内', column: 'コラムの予約', birthday_coupon: 'ペットの誕生日',
  }
  return labels[campaignKey] ?? '配信の決めごと'
}

function shortDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '日時不明' : new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(date)
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <label className="text-xs font-bold text-ink">{label}<input value={value} readOnly className="mt-2 block w-full rounded-v6-control border border-hairline bg-surface-muted px-3 py-2 text-sm text-ink" /></label>
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="text-xs font-bold text-ink">{label}<input type="number" min={1} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 block w-full rounded-v6-control border border-hairline px-3 py-2 text-sm text-ink" /></label>
}

function columnDeliveryDate(column: NenColumn) {
  if (column.deliveryStatus === 'draft') return '下書き'
  const source = column.deliveryAt || column.publishedAt
  if (!source) return columnStatusLabel[column.deliveryStatus]
  const date = new Date(source)
  return Number.isNaN(date.getTime()) ? '日時を確認できません' : new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(date)
}

function columnMetricDate(value: string | null) {
  if (!value) return '日時未定'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '日時を確認できません' : new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(date)
}

function petTypeLabel(type: NenPetProfile['animalType']) {
  return type === 'dog' ? '犬' : type === 'cat' ? '猫' : 'その他'
}

function petAge(birthday: string | null) {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return ''
  const born = new Date(`${birthday}T00:00:00+09:00`)
  if (Number.isNaN(born.getTime())) return ''
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  if (now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) age -= 1
  return age >= 0 ? ` ${age}歳` : ''
}

function petBirthdayLabel(birthday: string | null) {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return '未登録'
  return `${Number(birthday.slice(5, 7))}/${Number(birthday.slice(8, 10))}`
}

function nextBirthdayLabel(birthday: string | null) {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return '送れません'
  const now = new Date()
  const month = Number(birthday.slice(5, 7))
  const day = Number(birthday.slice(8, 10))
  const delivery = new Date(now.getFullYear(), month - 1, day - 3)
  if (delivery.getTime() < now.getTime()) delivery.setFullYear(delivery.getFullYear() + 1)
  return `${delivery.getMonth() + 1}/${delivery.getDate()} に誕生日クーポン`
}
