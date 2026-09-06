'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SearchField from '@/components/shared/search-field'
import SelectField from '@/components/shared/select-field'
import SummaryCard from '@/components/shared/summary-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import type { NenCampaignSetting, NenColumn, NenPetProfile } from '@/lib/api'
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

type Overview = {
  activeCampaigns: number
  jobs: { total?: number; pending: number; sent: number; failed: number }
  columns: number
  pets: number
  coupons: number
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
  settings,
  columns,
  pets,
  jobs,
  overview,
}: {
  tab: NenTab
  settings: NenCampaignSetting[]
  columns: NenColumn[]
  pets: NenPetProfile[]
  jobs: NenJob[]
  overview: Overview | null
}) {
  const active = settings.filter((setting) => setting.isEnabled).length
  const stopped = settings.length - active
  const sentColumns = columns.filter((column) => column.deliveryStatus === 'sent').length
  const draftColumns = columns.filter((column) => column.deliveryStatus === 'draft').length
  const nextColumn = columns
    .filter((column) => column.deliveryAt && ['scheduled', 'queued'].includes(column.deliveryStatus))
    .sort((a, b) => String(a.deliveryAt).localeCompare(String(b.deliveryAt)))[0]
  const currentMonth = new Date().getMonth() + 1
  const birthdayThisMonth = pets.filter((pet) => {
    const month = pet.birthday ? Number(pet.birthday.slice(5, 7)) : 0
    return month === currentMonth
  }).length
  const cards = tab === 'flow'
    ? [
        { title: '動いている配信', value: active, unit: 'つ', detail: `止めているもの ${stopped}つ` },
        { title: 'この30日に送った', value: null, unit: '通', detail: '期間別の送信集計が接続されると表示します' },
        { title: '押された割合', value: null, unit: '%', detail: '反応集計が接続されると表示します' },
        { title: 'この配信からの成果', value: null, unit: '件', detail: 'コンバージョン連携が接続されると表示します' },
      ]
    : tab === 'columns'
      ? [
          { title: '出したコラム', value: sentColumns, unit: '本', detail: `下書き ${draftColumns}本` },
          { title: '次に出すもの', value: nextColumn ? 1 : 0, unit: '本', detail: nextColumn?.title ?? '予約ずみのコラムはありません' },
          { title: 'いちばん読まれた', value: null, unit: '本', detail: '読了集計が接続されると表示します' },
          { title: 'コラムからの成果', value: null, unit: '件', detail: '成果集計が接続されると表示します' },
        ]
      : tab === 'pets'
        ? [
            { title: 'ペットの登録', value: overview?.pets ?? pets.length, unit: '匹', detail: '選択中のLINEアカウント' },
            { title: '今月 誕生日の子', value: birthdayThisMonth, unit: '匹', detail: '誕生日が登録されている子' },
            { title: '誕生日配信の開封', value: null, unit: '%', detail: '反応集計が接続されると表示します' },
            { title: '誕生日クーポンの利用', value: null, unit: '%', detail: 'クーポン利用集計が接続されると表示します' },
          ]
        : [
            { title: '送りました', value: overview?.jobs.sent ?? null, unit: '通', detail: '取得できる全期間の合計' },
            { title: 'これから送る', value: overview?.jobs.pending ?? null, unit: '通', detail: '送信待ちの記録' },
            { title: '届かなかった', value: overview?.jobs.failed ?? null, unit: '通', detail: '送信できなかった記録' },
            { title: 'やり直しが必要', value: jobs.filter((job) => job.status === 'failed' && job.attempts >= 3).length, unit: '通', detail: '3回失敗した記録' },
          ]

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-design="KPIs">
      {cards.map((card) => <SummaryCard key={card.title} {...card} variant="v6" />)}
    </div>
  )
}

export function NenOverview({
  tab,
  onTabChange,
  settings,
  columns,
  pets,
  jobs,
  overview,
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
  onToggleSetting,
  onTestSend,
  onPetDraftChange,
  onAddPet,
  onDeletePet,
  onCouponChange,
  onSaveCoupon,
  renderCampaignPreview,
  renderColumnPreview,
}: {
  tab: NenTab
  onTabChange: (tab: NenTab) => void
  settings: NenCampaignSetting[]
  columns: NenColumn[]
  pets: NenPetProfile[]
  jobs: NenJob[]
  overview: Overview | null
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
  onToggleSetting: (setting: NenCampaignSetting) => void
  onTestSend: (setting: NenCampaignSetting) => void
  onPetDraftChange: (draft: { friendId: string; name: string; animalType: string; gender: string; birthday: string }) => void
  onAddPet: () => void
  onDeletePet: (pet: NenPetProfile) => void
  onCouponChange: (coupon: NenCoupon) => void
  onSaveCoupon: () => void
  renderCampaignPreview: (setting: NenCampaignSetting) => ReactNode
  renderColumnPreview: (column: NenColumn) => ReactNode
}) {
  return (
    <main className="mx-auto flex w-full flex-col gap-4 px-4 pb-8 sm:px-6" style={{ maxWidth: 1600 }} data-design-node={tab === 'flow' ? 'VLMGH' : tab === 'columns' ? 'DEX0k' : tab === 'pets' ? 'q4lajm' : 'WeXbL'}>
      <Tabs
        items={[
          { label: '配信フロー', count: settings.length, current: tab === 'flow', onClick: () => onTabChange('flow') },
          { label: 'NENコラム', count: columns.length, current: tab === 'columns', onClick: () => onTabChange('columns') },
          { label: 'ペット・記念日', current: tab === 'pets', onClick: () => onTabChange('pets') },
          { label: '配信履歴', current: tab === 'history', onClick: () => onTabChange('history') },
        ]}
      />
      <Kpis tab={tab} settings={settings} columns={columns} pets={pets} jobs={jobs} overview={overview} />
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
          onShowHistory={() => onTabChange('history')}
          renderPreview={renderColumnPreview}
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
        />
      ) : null}
      {tab === 'history' ? <HistoryPanel jobs={jobs} /> : null}
    </main>
  )
}

function FlowPanel({
  settings,
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
    ['order_thanks', '注文が確定', 'すぐ', '注文ありがとうございます'],
    ['shipping_notice', '発送しました', '当日', 'お荷物の追跡番号'],
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
            const active = settings.find((setting) => setting.campaignKey === campaignKey)?.isEnabled === true
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
            <thead className="bg-surface-muted text-left text-xs text-ink-faint"><TableHeadRow><Th style={{ width: '31%' }}>配信</Th><Th style={{ width: '21%' }}>いつ送るか</Th><Th style={{ width: '18%' }}>中身</Th><Th style={{ width: '12%' }}>この30日</Th><Th style={{ width: '18%' }}>操作</Th></TableHeadRow></thead>
            <tbody>
              {deliverySettings.map((setting) => (
                <Fragment key={setting.campaignKey}>
                  <tr className="border-t border-hairline">
                    <td className="px-3 py-3"><p className="font-bold text-ink">{setting.label}</p><p className="mt-1 text-xs text-ink-faint">{categoryLabel[setting.category]} ／ {formatCampaignTiming(setting)}</p></td>
                    <td className="px-3 py-3 text-ink-secondary">{formatCampaignTiming(setting)}</td>
                    <td className="px-3 py-3 text-ink-secondary">{formatCampaignContent(setting)}</td>
                    <td className="px-3 py-3 text-xs text-ink-faint">集計未接続</td>
                    <td className="px-3 py-3"><div className="flex flex-wrap justify-end gap-2"><Button onClick={() => onPreview(previewCampaignKey === setting.campaignKey ? null : setting.campaignKey)}>{previewCampaignKey === setting.campaignKey ? '閉じる' : '中身を見る'}</Button><Button onClick={() => onToggle(setting)} disabled={saving === setting.campaignKey}>{setting.isEnabled ? '止める' : '動かす'}</Button></div></td>
                  </tr>
                  {previewCampaignKey === setting.campaignKey ? <tr key={`${setting.campaignKey}-preview`}><td colSpan={5} className="border-t border-hairline p-3">{renderPreview(setting)}</td></tr> : null}
                </Fragment>
              ))}
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
  previewColumnId,
  editingColumnId,
  savingColumnId,
  onPreview,
  onEdit,
  onUpdate,
  onSave,
  onDeliver,
  onShowHistory,
  renderPreview,
}: {
  columns: NenColumn[]
  previewColumnId: string | null
  editingColumnId: string | null
  savingColumnId: string | null
  onPreview: (id: string | null) => void
  onEdit: (id: string | null) => void
  onUpdate: (id: string, text: string) => void
  onSave: (column: NenColumn) => void
  onDeliver: (column: NenColumn, scheduledAt?: string) => void
  onShowHistory: () => void
  renderPreview: (column: NenColumn) => ReactNode
}) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | NenColumn['deliveryStatus']>('all')
  const [page, setPage] = useState(1)
  const shown = columns.filter((column) => {
    const matchesSearch = `${column.title} ${column.excerpt} ${column.category ?? ''}`.toLowerCase().includes(search.toLowerCase())
    return matchesSearch && (status === 'all' || column.deliveryStatus === status)
  })
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
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="w-full" style={{ maxWidth: 460 }}><SearchField value={search} onChange={(value) => { setSearch(value); setPage(1) }} onClear={() => { setSearch(''); setPage(1) }} placeholder="コラムの題名・概要で検索" /></div><Button href="/nen-campaigns/columns/new" variant="primary">コラムを書く</Button></div>
      <div className="flex flex-wrap gap-2">{[
        ['all', `すべて ${columns.length}`], ['sent', `出したもの ${count('sent')}`], ['draft', `下書き ${count('draft')}`], ['scheduled', `予約ずみ ${count('scheduled')}`],
      ].map(([value, label]) => <FilterChip key={value} selected={status === value} onChange={(selected) => { setStatus(selected ? value as typeof status : 'all'); setPage(1) }}>{label}</FilterChip>)}</div>
      {shown.length === 0 ? (
        <ListState kind="empty" title={columns.length === 0 ? 'まだコラムがありません' : '条件に合うコラムはありません'} description="外部サイトの記事へつなぐ下書きを作ると、ここに並びます。" action={<Button href="/nen-campaigns/columns/new" variant="primary">コラムを書く</Button>} />
      ) : (
        <section className="overflow-hidden rounded-v6-card border border-hairline bg-canvas shadow-v6-card">
          <table className="w-full table-fixed border-separate border-spacing-0 text-sm"><thead className="bg-surface-muted text-left text-xs text-ink-faint"><TableHeadRow><Th style={{ width: '34%' }}>コラム</Th><Th style={{ width: '14%' }}>出す日</Th><Th style={{ width: '14%' }}>届く人</Th><Th style={{ width: '14%' }}>読まれた</Th><Th style={{ width: '24%' }}>操作</Th></TableHeadRow></thead><tbody>
            {visible.map((column) => (
              <Fragment key={column.id}>
                <tr><td className="border-t border-hairline px-3 py-3"><p className="font-bold text-ink">{column.title}</p><p className="mt-1 text-xs text-ink-faint">{column.category || '分類なし'} ／ {column.excerpt || '概要なし'}</p></td><td className="border-t border-hairline px-3 py-3 text-ink-secondary">{columnDeliveryDate(column)}</td><td className="border-t border-hairline px-3 py-3 text-xs text-ink-faint">対象人数未接続</td><td className="border-t border-hairline px-3 py-3 text-xs text-ink-faint">読了集計未接続</td><td className="border-t border-hairline px-3 py-3"><div className="flex flex-wrap justify-end gap-2"><Button onClick={() => onPreview(previewColumnId === column.id ? null : column.id)}>中身を見る</Button><Button onClick={onShowHistory}>配信結果</Button><Button onClick={() => onEdit(editingColumnId === column.id ? null : column.id)}>{editingColumnId === column.id ? '設定を閉じる' : '配信を設定'}</Button></div></td></tr>
                {previewColumnId === column.id ? <tr key={`${column.id}-preview`}><td colSpan={5} className="border-t border-hairline p-3">{renderPreview(column)}</td></tr> : null}
                {editingColumnId === column.id ? <tr key={`${column.id}-controls`}><td colSpan={5} className="border-t border-hairline bg-surface-muted px-3 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><Button onClick={() => onEdit(null)}>設定を閉じる</Button><Button onClick={() => onDeliver(column)} variant="primary">今すぐ配信予約</Button><input type="datetime-local" aria-label={`${column.title}の配信日時`} onChange={(event) => event.target.value && onDeliver(column, new Date(event.target.value).toISOString())} className="rounded-v6-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink" /></div><span className="text-xs font-semibold text-ink-secondary">{columnStatusLabel[column.deliveryStatus]}</span></div><div className="mt-3"><label className="text-sm font-bold text-ink">カードの前に送る紹介文<textarea value={column.introText} rows={5} maxLength={1500} onChange={(event) => onUpdate(column.id, event.target.value)} className="mt-2 block w-full rounded-v6-control border border-hairline bg-canvas px-3 py-2 text-sm leading-6 text-ink" /></label><div className="mt-2 flex justify-end"><Button variant="primary" disabled={savingColumnId === column.id} onClick={() => onSave(column)}>{savingColumnId === column.id ? '保存中...' : '配信文を保存'}</Button></div></div></td></tr> : null}
              </Fragment>
            ))}
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

function PetsPanel({ pets, coupon, friends, petDraft, onPetDraftChange, onAddPet, onDeletePet, onCouponChange, onSaveCoupon }: {
  pets: NenPetProfile[]
  coupon: NenCoupon
  friends: Array<{ id: string; displayName: string | null }>
  petDraft: { friendId: string; name: string; animalType: string; gender: string; birthday: string }
  onPetDraftChange: (draft: { friendId: string; name: string; animalType: string; gender: string; birthday: string }) => void
  onAddPet: () => void
  onDeletePet: (pet: NenPetProfile) => void
  onCouponChange: (coupon: NenCoupon) => void
  onSaveCoupon: () => void
}) {
  const previewPet = pets.find((pet) => pet.birthday) ?? pets[0]
  const missingBirthday = pets.filter((pet) => !pet.birthday).length
  return (
    <>
      <NoteBar>名前と誕生日は、答えてくれた方のペット情報だけを使います。誕生日は3日前の10:00に送ります。</NoteBar>
      <section className="rounded-v6-card border border-hairline bg-canvas p-4 shadow-v6-card"><h2 className="text-base font-bold text-ink">誕生日クーポンの決めごと</h2><div className="mt-4 grid gap-3 md:grid-cols-5"><ReadOnlyField label="いつ送るか" value="誕生日の3日前" /><ReadOnlyField label="時刻" value="10:00" /><NumberField label="割引の額（円）" value={coupon.discountAmount} onChange={(value) => onCouponChange({ ...coupon, discountAmount: value })} /><NumberField label="使える日数" value={coupon.validityDays} onChange={(value) => onCouponChange({ ...coupon, validityDays: value })} /><label className="text-xs font-bold text-ink">クーポンの頭の文字<input value={coupon.codePrefix} onChange={(event) => onCouponChange({ ...coupon, codePrefix: event.target.value.toUpperCase() })} className="mt-2 block w-full rounded-v6-control border border-hairline px-3 py-2 text-sm" /></label></div><div className="mt-3 flex justify-end"><Button variant="primary" onClick={onSaveCoupon}>設定を保存</Button></div></section>
      <div className="grid gap-4 xl:grid-cols-3">
        <section className="overflow-hidden rounded-v6-card border border-hairline bg-canvas shadow-v6-card xl:col-span-2"><div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline p-4"><div><h2 className="text-base font-bold text-ink">登録してもらったペット</h2><p className="mt-1 text-xs text-ink-faint">名前は配信に差し込まれます。まちがいがあると、そのまま届きます。</p></div><details><summary className="cursor-pointer text-sm font-bold text-v6-action">ペット情報を登録</summary><div className="mt-3 grid gap-2 sm:grid-cols-2"><SelectField value={petDraft.friendId} onChange={(event) => onPetDraftChange({ ...petDraft, friendId: event.target.value })} aria-label="ペット情報を登録するLINEユーザー" options={[{ value: '', label: 'LINEユーザーを選択' }, ...friends.map((friend) => ({ value: friend.id, label: friend.displayName || '名前未取得' }))]} /><input aria-label="ペットの名前" placeholder="ペットの名前" value={petDraft.name} onChange={(event) => onPetDraftChange({ ...petDraft, name: event.target.value })} className="rounded-v6-control border border-hairline px-3 py-2 text-sm" /><input aria-label="ペットの誕生日" type="date" value={petDraft.birthday} onChange={(event) => onPetDraftChange({ ...petDraft, birthday: event.target.value })} className="rounded-v6-control border border-hairline px-3 py-2 text-sm" /><Button variant="primary" onClick={onAddPet}>登録する</Button></div></details></div>{pets.length === 0 ? <ListState kind="empty" title="ペットはまだ登録されていません" description="聞きとりフォームか、この画面から登録してください。" /> : <table className="w-full table-fixed text-sm"><thead className="bg-surface-muted text-left text-xs text-ink-faint"><TableHeadRow><Th style={{ width: '26%' }}>ペット</Th><Th style={{ width: '20%' }}>飼い主</Th><Th style={{ width: '14%' }}>誕生日</Th><Th style={{ width: '25%' }}>次の配信</Th><Th style={{ width: '15%' }}>操作</Th></TableHeadRow></thead><tbody>{pets.map((pet) => <tr key={pet.id}><td className="border-t border-hairline px-3 py-3"><p className="font-bold text-ink">{pet.name}</p><p className="text-xs text-ink-faint">{petTypeLabel(pet.animalType)}{petAge(pet.birthday)}</p></td><td className="border-t border-hairline px-3 py-3 text-ink-secondary">{pet.ownerName || '名前未取得'}</td><td className="border-t border-hairline px-3 py-3 font-semibold text-ink">{petBirthdayLabel(pet.birthday)}</td><td className="border-t border-hairline px-3 py-3 text-ink-secondary">{nextBirthdayLabel(pet.birthday)}</td><td className="border-t border-hairline px-3 py-3"><Button onClick={() => onDeletePet(pet)}>登録を外す</Button></td></tr>)}</tbody></table>}</section>
        <aside className="flex flex-col gap-4"><section className="rounded-v6-card border border-hairline bg-canvas p-4 shadow-v6-card"><h2 className="text-sm font-bold text-ink">{previewPet ? `${previewPet.name}にはこう届きます` : 'LINEプレビュー'}</h2><div className="mt-3 rounded-v6-card bg-info-bg p-4"><p className="text-center text-xs font-bold text-ink-secondary">LINEプレビュー</p><p className="mt-3 text-center text-xs font-bold text-ink-secondary">誕生日の3日前 10:00 に届きます</p><div className="mt-3 rounded-v6-control bg-canvas p-4"><p className="text-sm font-bold leading-6 text-ink">{previewPet ? `${previewPet.name}、もうすぐお誕生日ですね。おめでとうございます。` : 'ペットを登録すると文面を確認できます。'}</p><p className="mt-2 text-sm leading-6 text-ink-secondary">お祝いに{coupon.discountAmount.toLocaleString('ja-JP')}円ぶんのクーポンをお送りします。{coupon.validityDays}日間お使いいただけます。</p><p className="mt-3 rounded-v6-control bg-v6-action py-2 text-center text-sm font-bold text-on-accent">クーポンを受け取る</p></div></div></section><section className="rounded-v6-card border border-warning bg-warning-bg p-4"><h2 className="text-sm font-bold text-warning">手を入れたほうがよいところ</h2><p className="mt-3 text-sm font-bold text-warning">誕生日が入っていない子が {missingBirthday}匹</p><p className="mt-1 text-xs leading-5 text-ink-secondary">名前だけ登録されています。もう一度お願いを出せます。</p><p className="mt-3 text-sm font-bold text-warning">まだ登録していない人は未取得</p><p className="mt-1 text-xs leading-5 text-ink-secondary">友だち全体との照合が接続されると表示します。</p></section></aside>
      </div>
    </>
  )
}

function HistoryPanel({ jobs }: { jobs: NenJob[] }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'sent' | 'pending' | 'failed'>('all')
  const shown = useMemo(() => jobs.filter((job) => {
    const matches = `${job.friendName ?? ''} ${job.label}`.toLowerCase().includes(search.toLowerCase())
    const statusMatches = filter === 'all' || (filter === 'pending' ? ['pending', 'processing'].includes(job.status) : job.status === filter)
    return matches && statusMatches
  }), [filter, jobs, search])
  const count = (status: string) => jobs.filter((job) => job.status === status).length
  return (
    <>
      <NoteBar>いつ・だれに・何を送ったかの記録です。届かなかったものもここで分かります。</NoteBar>
      <div className="w-full" style={{ maxWidth: 460 }}><SearchField value={search} onChange={setSearch} onClear={() => setSearch('')} placeholder="友だちの名前・配信の名前で検索" /></div>
      <div className="flex flex-wrap gap-2">{[['all', `すべて ${jobs.length}`], ['sent', `送りました ${count('sent')}`], ['pending', `これから ${count('pending')}`], ['failed', `届きませんでした ${count('failed')}`]].map(([value, label]) => <FilterChip key={value} selected={filter === value} onChange={(selected) => setFilter(selected ? value as typeof filter : 'all')}>{label}</FilterChip>)}</div>
      {shown.length === 0 ? <ListState kind="empty" title="配信履歴はまだありません" description="配信が予約されると、送信前からここに記録が並びます。" /> : <section className="overflow-hidden rounded-v6-card border border-hairline bg-canvas shadow-v6-card"><table className="w-full table-fixed text-sm"><thead className="bg-surface-muted text-left text-xs text-ink-faint"><TableHeadRow><Th style={{ width: '28%' }}>いつ・だれに</Th><Th style={{ width: '22%' }}>配信</Th><Th style={{ width: '17%' }}>状態</Th><Th style={{ width: '18%' }}>きっかけ</Th><Th style={{ width: '15%' }}>反応</Th></TableHeadRow></thead><tbody>{shown.map((job) => <tr key={job.id}><td className="border-t border-hairline px-3 py-3"><p className="font-bold text-ink">{formatNenJobDateTime(job.sentAt || job.scheduledAt)} ／ {job.friendName || '名前未取得'}</p><p className="mt-1 text-xs text-ink-faint">{job.lineAccountName || '選択中のLINEアカウント'}</p></td><td className="border-t border-hairline px-3 py-3 text-ink">{job.label}</td><td className="border-t border-hairline px-3 py-3 font-semibold text-ink">{statusLabel[job.status] ?? '状態を確認できません'}</td><td className="border-t border-hairline px-3 py-3 text-xs text-ink-faint">{job.triggerLabel || 'きっかけ記録未接続'}</td><td className="border-t border-hairline px-3 py-3 text-xs text-ink-faint">{job.reactionLabel || '反応集計未接続'}</td></tr>)}</tbody></table></section>}
      <p className="text-xs text-ink-faint">記録 {jobs.length}件中 {shown.length === 0 ? 0 : 1}〜{shown.length}件を表示</p>
    </>
  )
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
