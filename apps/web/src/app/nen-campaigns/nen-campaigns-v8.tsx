'use client'

/*
 * ★V8-B NEN配信（Pencil「★V8-B 画面の地図」専用機能の組：
 * 自動配信 `MuhWR`・コラム `Jxmqh`・送った履歴 `Tj7n4`・
 * クーポンの決めごと `oqSJP`・状態の板 `dzx5D`）。
 * コラムを書く `yRDwW`・配信を直す `w5pwG` は別の道の画面。
 *
 * v7（page.tsx の持ち方と nen-overview）とは別の見せ方として持ち、
 * data-theme="v8" のときだけこちらが出る。データの口（settings・
 * columns・overview・deliveries・coupon・columns関連）はすべて
 * page.tsx が持ったまま。違いは置き場と見せ方だけ——
 * ・数の帯は1枚の白い板に区切り線で4つ（離したカードにしない）。
 * ・札の順は 自動配信・コラム・停止中・送った履歴。
 * ・自動配信の列は今の作りと同じ。行末は「…」に集約。
 * ・コラムは表＋選んだコラムのカード。履歴は表＋「…」に再送。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import { Inbox, MailOpen, Megaphone, Newspaper } from 'lucide-react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import PageSizeSelect from '@/components/ui/page-size-select'
import ListRange from '@/components/ui/list-range'
import { RowActions } from '@/components/shared/row-actions'
import type { ActionMenuItem } from '@/components/shared/action-menu'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import { TextArea, TextField } from '@/components/shared/text-field'
import DateTimeField from '@/components/shared/date-time-field'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import type { NenCampaignSetting, NenColumn } from '@/lib/api'
import { csvCell } from '@/lib/presentation'
import { formatNumber } from '@/lib/format'
import { campaignTriggerLabel, formatCampaignAudience, formatCampaignTiming, formatNenJobDateTime } from './campaign-display'
import { isPastScheduledAt, publishedAtIso } from './columns/new/column-form'
import { jstLongDateTime, jstShortDate } from './nen-period'
import {
  CouponDrawer,
  canRetryDelivery,
  columnDeliveryBadge,
  deliveryTriggerLabel,
  num,
  skippedNoRetryNote,
  skippedReasonsDetail,
  statusLabel,
  TestRecipientPicker,
  type NenOverviewProps,
  type NenTab,
} from './nen-overview'
import styles from './nen-campaigns-v8.module.css'

/** 板ごとの data-design-node（札で切り替える外枠の印）。 */
const BOARD_NODE: Record<NenTab, string> = {
  auto: 'MuhWR',
  columns: 'Jxmqh',
  paused: 'MuhWR',
  history: 'Tj7n4',
}

const TAB_LABEL: Record<NenTab, string> = {
  auto: '自動配信',
  columns: 'コラム',
  paused: '停止中',
  history: '送った履歴',
}

/* 自動配信のCSV（MuhWR の「CSV で書き出す」。一覧に出ている決めごとをそのまま出す）。 */
function autoSettingsToCsv(settings: NenCampaignSetting[], sentByKey: Map<string, number>): string {
  const header = ['配信名', 'きっかけ', '対象', '状態', '今月送信（通）']
  const lines = settings.map((setting) => [
    setting.label,
    formatCampaignTiming(setting),
    formatCampaignAudience(setting),
    setting.isEnabled ? '動いている' : '止めている',
    String(sentByKey.get(setting.campaignKey) ?? 0),
  ].map(csvCell).join(','))
  return `\uFEFF${[header.join(','), ...lines].join('\n')}`
}

/**
 * NEN配信の V8 画面。外枠（見出し・札・数の帯）は全部の札で同じ。
 * 取得・保存は page.tsx が持つ。ここは見せ方だけ。
 */
export default function NenCampaignsV8(props: NenOverviewProps) {
  const { tab, settings, columns, kpis, flowMetrics, columnMetrics } = props
  const autoCount = settings.filter((setting) => setting.isEnabled).length
  const pausedCount = settings.length - autoCount
  const publishedColumns = columns.filter((column) => column.publishedAt != null)
  const draftColumns = columns.filter((column) => column.publishedAt == null)

  const [exporting, setExporting] = useState(false)
  const exportCsv = () => {
    if (exporting) return
    setExporting(true)
    try {
      const sentByKey = new Map((flowMetrics?.flows ?? []).map((flow) => [flow.campaignKey, flow.sent]))
      const blob = new Blob([autoSettingsToCsv(settings, sentByKey)], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nen-auto-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div data-design-node={BOARD_NODE[tab]} className={styles.board}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>NEN配信</h1>
          <p className={styles.headDesc}>ネットショップの注文や誕生日に合わせて、決まったメッセージやコラムを自動で送ります。</p>
        </div>
        {tab === 'columns' ? (
          <Button href="/nen-campaigns/columns/new">コラムを書く</Button>
        ) : (
          <Button type="button" variant="secondary" onClick={exportCsv} disabled={exporting}>CSVで書き出す</Button>
        )}
      </div>
      <div data-design="Tabs" data-design-node="nen-tabs-v8">
        <Tabs
          items={[
            { label: '自動配信', count: autoCount, current: tab === 'auto', onClick: () => props.onTabChange('auto') },
            { label: 'コラム', count: columns.length, current: tab === 'columns', onClick: () => props.onTabChange('columns') },
            { label: '停止中', count: pausedCount, current: tab === 'paused', onClick: () => props.onTabChange('paused') },
            { label: '送った履歴', current: tab === 'history', onClick: () => props.onTabChange('history') },
          ]}
        />
      </div>

      <NenKpiBandV8
        tab={tab}
        monthLabel={kpis?.monthLabel ?? ''}
        loading={props.loading && !kpis}
        autoTotal={settings.length}
        autoEnabled={autoCount}
        autoPaused={pausedCount}
        sentThisMonth={kpis?.sentThisMonth ?? null}
        sentLastMonth={kpis?.sentLastMonth ?? null}
        openRate={kpis?.openRate ?? null}
        columnTotal={columns.length}
        columnPublished={publishedColumns.length}
        columnDrafts={draftColumns.length}
      />

      {tab === 'columns' ? (
        <ColumnsV8 {...props} />
      ) : tab === 'history' ? (
        <HistoryV8 {...props} />
      ) : (
        <AutoV8 {...props} pausedOnly={tab === 'paused'} />
      )}

      <CouponDrawer
        open={props.couponOpen}
        coupon={props.coupon}
        saving={props.savingCoupon}
        onClose={() => props.onCouponOpenChange(false)}
        onChange={props.onCouponChange}
        onSave={props.onSaveCoupon}
      />
    </div>
  )
}

/**
 * 数の帯。1枚の白い板を区切り線で4つに分ける（★V8 の決まり：
 * 数の帯はカードを離して並べず、白い板の左右いっぱいに置く）。
 * 開封のマスだけ札で中身が変わる（自動配信は注意・履歴は取得不可）。
 */
function NenKpiBandV8({
  tab, monthLabel, loading,
  autoTotal, autoEnabled, autoPaused,
  sentThisMonth, sentLastMonth, openRate,
  columnTotal, columnPublished, columnDrafts,
}: {
  tab: NenTab
  monthLabel: string
  loading: boolean
  autoTotal: number
  autoEnabled: number
  autoPaused: number
  sentThisMonth: number | null
  sentLastMonth: number | null
  openRate: number | null
  columnTotal: number
  columnPublished: number
  columnDrafts: number
}) {
  const pending = loading
  const sentDiff = sentThisMonth != null && sentLastMonth != null ? sentThisMonth - sentLastMonth : null
  const cell = (
    icon: React.ReactNode,
    label: string,
    help: string,
    value: number | null,
    unit: string,
    sub: string,
  ) => (
    <li className={styles.kpiCell} key={label}>
      <div className={styles.kpiHead}>
        <span className={styles.kpiIcon} aria-hidden="true">{icon}</span>
        <span className={styles.kpiLabel}>{label}</span>
        <button type="button" className={styles.kpiHelp} title={help} aria-label={`${label}：${help}`}>…</button>
      </div>
      <p className={styles.kpiValue}>{value === null ? '—' : <>{formatNumber(value)}<span className={styles.kpiUnit}>{unit}</span></>}</p>
      <p className={styles.kpiSub}>{sub}</p>
    </li>
  )

  return (
    <ul className={styles.kpiBand} aria-label="NEN配信の数の帯">
      {cell(<Megaphone size={14} />, '自動配信', '決まったきっかけで送る配信の数です', pending ? null : autoTotal, '件', pending ? ' ' : `動いている ${autoEnabled}・止めている ${autoPaused}`)}
      {cell(<Inbox size={14} />, `今月送った`, '今月 送った通数です', pending ? null : sentThisMonth, '通', sentDiff == null ? (monthLabel ? `${monthLabel}の実績` : ' ') : `先月より ${sentDiff >= 0 ? `+${formatNumber(sentDiff)}` : formatNumber(sentDiff)}`)}
      {tab === 'history' ? (
        cell(<MailOpen size={14} />, '開封', '自動配信は LINE から個人の開封を取れません', null, '%', '配信ごとの開封の集計から')
      ) : (
        cell(<MailOpen size={14} />, '開封（コラムを開いた割合）', 'コラムの記事を開いた割合です', pending ? null : openRate, '%', tab === 'auto' ? '自動配信は開封を取れません（コラムだけ）' : 'コラムを開いた割合')
      )}
      {cell(<Newspaper size={14} />, 'コラム', '外部サイトの記事へつなぐ下書きの数です', pending ? null : columnTotal, '本', pending ? ' ' : `公開中 ${columnPublished}・下書き ${columnDrafts}`)}
    </ul>
  )
}

type AutoSortV8 = 'sent_desc' | 'name'

/**
 * 自動配信（MuhWR）。列は今の作りと同じ。道具の段は探す＋よく使う札3つ。
 * 行末は「…」に集約（編集・テスト送信・止める・送った履歴を見る）。
 */
function AutoV8(props: NenOverviewProps & { pausedOnly: boolean }) {
  const { settings, flowMetrics, kpis, loading, tabError = '', onRetryTab, pausedOnly } = props
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<NenCampaignSetting['category'] | ''>('')
  const [offOnly, setOffOnly] = useState(false)
  const [sort, setSort] = useState<AutoSortV8>('sent_desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const monthLabel = kpis?.monthLabel ?? ''
  // 今月の送信数（表の「9月送信」など）。取れていないときは出さない。
  const sentByKey = useMemo(
    () => new Map((flowMetrics?.flows ?? []).map((flow) => [flow.campaignKey, flow.sent])),
    [flowMetrics],
  )
  const resetPage = () => setPage(1)
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    const filtered = settings.filter((setting) => {
      if (pausedOnly ? setting.isEnabled : (!setting.isEnabled && !offOnly)) return false
      if (!pausedOnly && offOnly && setting.isEnabled) return false
      if (category && setting.category !== category) return false
      if (q && !`${setting.label} ${formatCampaignTiming(setting)}`.toLocaleLowerCase().includes(q)) return false
      return true
    })
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.label.localeCompare(b.label, 'ja')
      return (sentByKey.get(b.campaignKey) ?? 0) - (sentByKey.get(a.campaignKey) ?? 0)
    })
  }, [settings, pausedOnly, offOnly, category, query, sort, sentByKey])

  const followUpCount = settings.filter((s) => s.category === 'follow_up').length
  const birthdayCount = settings.filter((s) => s.category === 'birthday').length
  const offCount = settings.filter((s) => !s.isEnabled).length
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const pageItems = visible.slice((safePage - 1) * pageSize, safePage * pageSize)
  const filtering = query !== '' || category !== '' || offOnly

  return (
    <>
      <div data-design="Note" data-design-node="nen-auto-note-v8">
        <NoteBar tone="info">自動配信は、注文・発送・誕生日などのきっかけで送ります。止めると、そのあとのきっかけでは送りません。</NoteBar>
      </div>

      <div className={styles.tools} data-design="ListControls" data-design-node="nen-auto-controls-v8">
        <form
          className={styles.searchGrow}
          onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()); resetPage() }}
        >
          <TextField
            aria-label="配信を探す"
            placeholder="配信名で探す"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
        {pausedOnly ? null : (
          <>
            <FilterChip
              selected={category === 'follow_up'}
              onChange={(next) => { setCategory(next ? 'follow_up' : ''); resetPage() }}
              count={followUpCount}
              title="注文のあとの配信だけ出します"
            >
              注文のあと
            </FilterChip>
            <FilterChip
              selected={category === 'birthday'}
              onChange={(next) => { setCategory(next ? 'birthday' : ''); resetPage() }}
              count={birthdayCount}
              title="誕生日の配信だけ出します"
            >
              誕生日
            </FilterChip>
            <FilterChip
              selected={offOnly}
              onChange={(next) => { setOffOnly(next); resetPage() }}
              count={offCount}
              title="止めている配信だけ出します"
            >
              止めている
            </FilterChip>
          </>
        )}
        <span className={styles.toolsTail}>
          <Select
            aria-label="よく使う絞り込み"
            value={category}
            onChange={(value) => { setCategory(value as NenCampaignSetting['category'] | ''); resetPage() }}
            options={[
              { value: '', label: 'よく使う絞り込み' },
              { value: 'transactional', label: '注文・発送' },
              { value: 'follow_up', label: '注文のあと' },
              { value: 'column', label: 'コラム' },
              { value: 'birthday', label: 'ペットの誕生日' },
            ]}
          />
          <Select
            aria-label="並び順"
            value={sort}
            onChange={(value) => { setSort(value as AutoSortV8); resetPage() }}
            options={[
              { value: 'sent_desc', label: '並び：今月多く送った順' },
              { value: 'name', label: '並び：配信名順' },
            ]}
          />
          <span className={styles.rangeLabel}>{visible.length === 0 ? '—' : `${visible.length}件中 ${(safePage - 1) * pageSize + 1}〜${Math.min(visible.length, safePage * pageSize)}件`}</span>
          <PageSizeSelect
            value={pageSize}
            options={[10, 20, 50]}
            onChange={(value) => { setPageSize(value); resetPage() }}
          />
        </span>
      </div>

      <section data-design="Table" data-design-node="nen-auto-table-v8">
        {loading && settings.length === 0 ? (
          <ListState kind="loading" title="自動配信を読み込んでいます" />
        ) : tabError ? (
          <ListState kind="error" title="自動配信を読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。登録した内容は消えていません。" onRetry={onRetryTab} />
        ) : pageItems.length === 0 ? (
          filtering || pausedOnly ? (
            <ListState
              kind="empty"
              title={pausedOnly ? '止めている配信はありません' : '条件に合う配信はありません'}
              description={pausedOnly ? 'すべての自動配信が動いています。' : '検索や絞り込みを外すと、すべて出ます。'}
              action={filtering && !pausedOnly ? <Button variant="secondary" onClick={() => { setQuery(''); setDraft(''); setCategory(''); setOffOnly(false); resetPage() }}>条件を外す</Button> : undefined}
            />
          ) : (
            <ListState kind="empty" emptyPreset="readonly" title="自動配信はまだありません" description="決めごとを作ると、ここに並びます。" />
          )
        ) : (
          <>
            <div className={styles.tableWrap}>
              <DataTable className="@container">
                <thead>
                  <TableHeadRow>
                    <Th>配信</Th>
                    <Th>きっかけ</Th>
                    <Th>対象</Th>
                    <Th align="right">{monthLabel ? `${monthLabel}送信` : '今月送信'}</Th>
                    <Th align="right">注文</Th>
                    <Th>状態</Th>
                    <Th className="w-14" align="right"><span className="sr-only">操作</span></Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {pageItems.map((setting) => (
                    <AutoRowV8
                      key={setting.campaignKey}
                      setting={setting}
                      monthSent={sentByKey.get(setting.campaignKey)}
                      onTestSend={props.onTestSend}
                      onToggleSetting={props.onToggleSetting}
                      onTabChange={props.onTabChange}
                      onCouponOpenChange={props.onCouponOpenChange}
                    />
                  ))}
                </tbody>
              </DataTable>
            </div>
            <div className={styles.listFoot}>
              <ListRange
                total={visible.length}
                first={visible.length === 0 ? 0 : (safePage - 1) * pageSize + 1}
                last={Math.min(visible.length, safePage * pageSize)}
              />
              {visible.length > pageSize ? (
                <Pagination page={safePage} pageCount={pageCount} onPageChange={setPage} />
              ) : null}
            </div>
            <p className={styles.listHint}>行の「…」から 編集・テスト送信・止める・送った履歴を見る。</p>
          </>
        )}
      </section>
    </>
  )
}

function AutoRowV8({ setting, monthSent, onTestSend, onToggleSetting, onTabChange, onCouponOpenChange }: {
  setting: NenCampaignSetting
  monthSent: number | undefined
  onTestSend: (setting: NenCampaignSetting) => void
  onToggleSetting: (setting: NenCampaignSetting) => void
  onTabChange: (tab: NenTab) => void
  onCouponOpenChange: (open: boolean) => void
}) {
  const menuItems: ActionMenuItem[] = [
    { id: 'edit', label: '編集', external: true, onSelect: () => { window.location.href = `/nen-campaigns/edit?key=${encodeURIComponent(setting.campaignKey)}` } },
    { id: 'test', label: 'テスト送信', onSelect: () => onTestSend(setting) },
    setting.isEnabled
      ? { id: 'stop', label: '止める', onSelect: () => onToggleSetting(setting) }
      : { id: 'start', label: '動かす', onSelect: () => onToggleSetting(setting) },
    { id: 'history', label: '送った履歴を見る', external: true, onSelect: () => onTabChange('history') },
  ]
  if (setting.campaignKey === 'birthday_coupon') {
    menuItems.splice(3, 0, { id: 'coupon', label: 'クーポンの決めごと', onSelect: () => onCouponOpenChange(true) })
  }
  return (
    <Tr>
      <Td>
        <Link href={`/nen-campaigns/edit?key=${encodeURIComponent(setting.campaignKey)}`} className="text-action hover:underline text-label font-semibold">
          {setting.label}
        </Link>
      </Td>
      <Td><span className="text-label text-ink-secondary">{formatCampaignTiming(setting)}</span></Td>
      <Td><span className="text-label text-ink-secondary">{formatCampaignAudience(setting)}</span></Td>
      <Td align="right"><span className="text-label tabular-nums text-ink">{monthSent == null ? '—' : formatNumber(monthSent)}</span></Td>
      <Td align="right"><span className="text-label tabular-nums text-ink-secondary">—</span></Td>
      <Td>
        {setting.isEnabled ? <StatusBadge tone="success">動いている</StatusBadge> : <StatusBadge tone="neutral">止めている</StatusBadge>}
      </Td>
      <Td align="right">
        <RowActions subjectName={setting.label} menuItems={menuItems} />
      </Td>
    </Tr>
  )
}

/**
 * コラム（Jxmqh）。列：コラム・分類・公開日・LINE配信・閲覧・「…」。
 * 道具の段は探す＋よく使う札（公開中・下書き）。表の下に選んだコラムのカード。
 * 行末は「…」に集約（編集・この内容で予約する・複製・下書きにして書く・止める）。
 */
function ColumnsV8(props: NenOverviewProps) {
  const { columns, columnsTotal, loading, tabError = '', onRetryTab } = props
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [stateFilter, setStateFilter] = useState<'' | 'published' | 'draft'>('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const resetPage = () => setPage(1)
  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const column of columns) {
      const key = column.category?.trim() || '分類なし'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [columns])
  const publishedCount = columns.filter((c) => c.publishedAt != null).length
  const draftCount = columns.length - publishedCount

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    return columns.filter((column) => {
      if (stateFilter === 'published' && column.publishedAt == null) return false
      if (stateFilter === 'draft' && column.publishedAt != null) return false
      if (categoryFilter && (column.category?.trim() || '分類なし') !== categoryFilter) return false
      if (q && !`${column.title} ${column.excerpt} ${column.category ?? ''}`.toLocaleLowerCase().includes(q)) return false
      return true
    })
  }, [columns, stateFilter, categoryFilter, query])

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const pageItems = visible.slice((safePage - 1) * pageSize, safePage * pageSize)
  const filtering = query !== '' || stateFilter !== '' || categoryFilter !== ''

  return (
    <>
      <div data-design="Note" data-design-node="nen-columns-note-v8">
        <NoteBar tone="info">コラムは外部サイトの記事へつなぐカードです。書いたあと、一覧の「この内容で予約する」で LINE に配信します。</NoteBar>
      </div>

      <div className={styles.tools} data-design="ListControls" data-design-node="nen-columns-controls-v8">
        <form
          className={styles.searchGrow}
          onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()); resetPage() }}
        >
          <TextField
            aria-label="コラムを探す"
            placeholder="コラムを探す"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
        <FilterChip
          selected={stateFilter === 'published'}
          onChange={(next) => { setStateFilter(next ? 'published' : ''); resetPage() }}
          count={publishedCount}
          title="公開中のコラムだけ出します"
        >
          公開中
        </FilterChip>
        <FilterChip
          selected={stateFilter === 'draft'}
          onChange={(next) => { setStateFilter(next ? 'draft' : ''); resetPage() }}
          count={draftCount}
          title="下書きのコラムだけ出します"
        >
          下書き
        </FilterChip>
        <span className={styles.toolsTail}>
          <Select
            aria-label="よく使う絞り込み"
            value={categoryFilter}
            onChange={(value) => { setCategoryFilter(value); resetPage() }}
            options={[
              { value: '', label: 'よく使う絞り込み' },
              ...categories.map(([name, count]) => ({ value: name, label: `${name} ${count}` })),
            ]}
          />
          <span className={styles.rangeLabel}>{visible.length === 0 ? '—' : `${visible.length}件中 ${(safePage - 1) * pageSize + 1}〜${Math.min(visible.length, safePage * pageSize)}件`}</span>
          <PageSizeSelect
            value={pageSize}
            options={[10, 20, 50]}
            onChange={(value) => { setPageSize(value); resetPage() }}
          />
        </span>
      </div>

      <section data-design="Table" data-design-node="nen-columns-table-v8">
        {loading && columns.length === 0 ? (
          <ListState kind="loading" title="コラムを読み込んでいます" />
        ) : tabError ? (
          <ListState kind="error" title="コラムを読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。登録した内容は消えていません。" onRetry={onRetryTab} />
        ) : pageItems.length === 0 ? (
          filtering ? (
            <ListState
              kind="empty"
              title="条件に合うコラムはありません"
              description="検索や絞り込みを外すと、すべて出ます。"
              action={<Button variant="secondary" onClick={() => { setQuery(''); setDraft(''); setStateFilter(''); setCategoryFilter(''); resetPage() }}>条件を外す</Button>}
            />
          ) : (
            <ListState kind="empty" emptyPreset="readonly" title="コラムはまだありません" description="右上の「コラムを書く」から下書きを作ると、ここに並びます。" />
          )
        ) : (
          <>
            <div className={styles.tableWrap}>
              <DataTable className="@container">
                <thead>
                  <TableHeadRow>
                    <Th>コラム</Th>
                    <Th>分類</Th>
                    <Th>公開日</Th>
                    <Th>LINE配信</Th>
                    <Th align="right">閲覧</Th>
                    <Th className="w-14" align="right"><span className="sr-only">操作</span></Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {pageItems.map((column) => (
                    <ColumnRowV8 key={column.id} column={column} {...props} />
                  ))}
                </tbody>
              </DataTable>
            </div>
            <div className={styles.listFoot}>
              <ListRange
                total={visible.length}
                first={visible.length === 0 ? 0 : (safePage - 1) * pageSize + 1}
                last={Math.min(visible.length, safePage * pageSize)}
              />
              {visible.length > pageSize ? (
                <Pagination page={safePage} pageCount={pageCount} onPageChange={setPage} />
              ) : null}
            </div>
            <p className={styles.listHint}>行の「…」から 編集・この内容で予約する・複製。</p>
          </>
        )}
      </section>

      {columnsTotal != null && columnsTotal > columns.length ? (
        <NoteBar tone="warn">{`コラムは${formatNumber(columnsTotal)}本ありますが、${columns.length}本までしか読み込んでいません。探すときは検索を使ってください。`}</NoteBar>
      ) : null}

      <SelectedColumnV8 {...props} />
    </>
  )
}

function columnViewsV8(column: NenColumn, columnMetrics: NenOverviewProps['columnMetrics']): string {
  const metric = columnMetrics?.columns.find((row) => row.id === column.id)
  const value = metric?.articleOpened.value
  return value == null ? '—' : formatNumber(value)
}

function ColumnRowV8({ column, ...props }: { column: NenColumn } & NenOverviewProps) {
  /*
   * 行の「…」は今ある口だけ。「下書きにして書く」「止める」は
   * コラム1本ごとの口が無いので置かない（止めるはコラム配信全体の決めごと）。
   */
  const menuItems: ActionMenuItem[] = [
    { id: 'edit', label: '編集', external: true, onSelect: () => { window.location.href = '/nen-campaigns/edit' } },
    { id: 'reserve', label: 'この内容で予約する', onSelect: () => props.onSelectColumn(column.id) },
    { id: 'duplicate', label: '複製', onSelect: () => props.onDuplicateColumn(column) },
  ]
  return (
    <Tr selected={props.selectedColumnId === column.id}>
      <Td>
        <span className="block text-label font-semibold text-ink">{column.title}</span>
        <span className="block truncate text-micro text-ink-faint" title={column.excerpt}>{column.publishedAt == null ? '下書き' : column.excerpt}</span>
      </Td>
      <Td><span className="text-label text-ink-secondary">{column.category?.trim() || '分類なし'}</span></Td>
      <Td><span className="text-label tabular-nums text-ink-secondary">{column.publishedAt ? jstShortDate(column.publishedAt) : '—'}</span></Td>
      <Td>{columnDeliveryBadge(column)}</Td>
      <Td align="right"><span className="text-label tabular-nums text-ink">{columnViewsV8(column, props.columnMetrics)}</span></Td>
      <Td align="right">
        <RowActions subjectName={column.title} menuItems={menuItems} />
      </Td>
    </Tr>
  )
}

/**
 * 選んだコラム（Jxmqh の表の下）。LINEに届く紹介文と、送る相手・日時を決める。
 * 予約の確定は確認の窓を挟む（二重押し防止）。
 */
function SelectedColumnV8(props: NenOverviewProps) {
  const { columns, selectedColumnId, plan, audienceCount, friends, testFriendId, introDraft } = props
  const selected = columns.find((column) => column.id === selectedColumnId) ?? null
  const [confirmDeliver, setConfirmDeliver] = useState<{ column: NenColumn; scheduledAt?: string } | null>(null)
  if (!selected) return null

  const scheduledIso = plan.when === 'schedule' ? publishedAtIso(plan.scheduledAt) : null
  const scheduleInvalid = plan.when === 'schedule' && (!scheduledIso || (scheduledIso != null && isPastScheduledAt(scheduledIso)))
  const schedulePast = plan.when === 'schedule' && scheduledIso != null && isPastScheduledAt(scheduledIso)
  const columnEnabled = props.settings.some((setting) => setting.campaignKey === 'column' && setting.isEnabled)
  const testing = props.testing

  return (
    <section className={styles.selectPanel} aria-label={`選んだコラム：${selected.title}`} data-design-node="nen-column-plan-v8">
      <h2 className={styles.selectTitle}>選んだコラム：{selected.title}</h2>
      <p className={styles.selectDesc}>LINEに届くカードと、送る相手・日時を決めます。</p>
      <div className={styles.selectGrid}>
        <label className={styles.fieldLabel}>
          LINEに出る紹介文
          <TextArea
            aria-label="LINEに出る紹介文"
            value={introDraft}
            onChange={(event) => props.onIntroChange(event.target.value)}
            rows={3}
            maxLength={1500}
          />
        </label>
        <div className={styles.fieldLabel}>
          だれに
          <p className={styles.selectDesc}>{selected.targetMode === 'tag' ? `タグで絞り込み（${audienceCount == null ? '—' : num(audienceCount)}人）` : `友だち 全員（${audienceCount == null ? '—' : num(audienceCount)}人）`}</p>
          <p className={styles.selectDesc}>送る相手はコラムを作るときに決めます。友だち解除・ブロックの人には送られません。</p>
        </div>
      </div>
      <div className={styles.fieldLabel}>
        いつ
        <RadioCardGroup legend="いつ">
          <RadioCard name="nen-deliver-when-v8" value="now" checked={plan.when === 'now'} onChange={() => props.onPlanChange({ ...plan, when: 'now' })} title="今すぐ" note="すぐに配信待ちに入ります。" />
          <RadioCard name="nen-deliver-when-v8" value="schedule" checked={plan.when === 'schedule'} onChange={() => props.onPlanChange({ ...plan, when: 'schedule' })} title="日時を予約" note="決めた日時に送ります。" />
        </RadioCardGroup>
        {plan.when === 'schedule' ? (
          <>
            <span className={styles.fieldLabel}>
              送る日時
              <DateTimeField aria-label="予約日時（日本時間）" value={plan.scheduledAt} invalid={scheduleInvalid} onChange={(v) => props.onPlanChange({ ...plan, scheduledAt: v })} />
            </span>
            {schedulePast ? (
              <span className={styles.fieldLabel}>予約日時が過去になっています。いまより先の日時を選んでください。</span>
            ) : null}
          </>
        ) : null}
      </div>
      <p className={styles.selectDesc}>
        {selected && audienceCount != null ? `送信数 約${num(audienceCount)}通。` : ''}
        {columnEnabled ? '' : 'コラムの配信が停止中のため、いまは送れません。上の「動かす」で再開できます。'}
      </p>
      <div className={styles.selectFoot}>
        <span className={styles.selectDesc}>{introDraft.length}／1500文字</span>
        <Button type="button" variant="secondary" disabled={introDraft === selected.introText || props.savingColumnId === selected.id || !introDraft.trim()} onClick={() => props.onSaveIntro(selected)} busy={props.savingColumnId === selected.id} busyLabel="保存中…">紹介文を保存する</Button>
        <Button type="button" variant="secondary" disabled={props.duplicatingColumnId === selected.id} onClick={() => props.onDuplicateColumn(selected)}>{props.duplicatingColumnId === selected.id ? '複製しています' : '同じ形で書く'}</Button>
        <TestRecipientPicker friends={friends} value={testFriendId} onChange={props.onTestFriendChange} accountId={props.accountId} />
        <Button type="button" variant="secondary" disabled={!testFriendId || testing !== null} onClick={() => props.onTestColumn(selected)} busy={testing === selected.id} busyLabel="送信中…">自分にテストを送る</Button>
        <Button type="button" variant="primary" disabled={!columnEnabled || scheduleInvalid} onClick={() => setConfirmDeliver({ column: selected, scheduledAt: scheduledIso ?? undefined })}>
          {plan.when === 'now' ? '配信を予約する' : '配信を予約する'}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDeliver !== null}
        title={confirmDeliver?.scheduledAt
          ? `「${confirmDeliver.column.title}」を配信予約しますか？`
          : `「${confirmDeliver?.column.title ?? ''}」を今すぐ配信しますか？`}
        description={confirmDeliver?.scheduledAt
          ? `${jstLongDateTime(confirmDeliver.scheduledAt)}（日本時間）に、${audienceCount == null ? '対象' : `約${num(audienceCount)}人`}の友だちへ送ります。`
          : `すぐに配信待ちに入り、${audienceCount == null ? '対象' : `約${num(audienceCount)}人`}の友だちへ送られます。`}
        confirmLabel={confirmDeliver?.scheduledAt ? '予約する' : '送る'}
        onConfirm={() => { if (confirmDeliver) props.onDeliverColumn(confirmDeliver.column, confirmDeliver.scheduledAt); setConfirmDeliver(null) }}
        onCancel={() => setConfirmDeliver(null)}
      />
    </section>
  )
}

type HistoryFilterV8 = 'all' | 'sent' | 'pending' | 'failed' | 'skipped'

/** チップの選択を配信状態の絞り込み文字列へ変える。「これから」だけ複数状態。 */
function historyViewStatus(filter: HistoryFilterV8): string | undefined {
  if (filter === 'all') return undefined
  if (filter === 'pending') return 'pending,processing'
  return filter
}

/**
 * 送った履歴（Tj7n4）。列：いつ・だれに・配信・状態・きっかけ・開封・「…」。
 * 再送の導線は行の「…」の中（中身を見る・再送待ちへ戻す）。
 */
function HistoryV8(props: NenOverviewProps) {
  const { deliveryList, deliveryDetail, loading, tabError = '', onRetryTab } = props
  const [draft, setDraft] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [filter, setFilter] = useState<HistoryFilterV8>('all')
  const [retryReasons, setRetryReasons] = useState<Record<string, string>>({})
  const [retryFocusId, setRetryFocusId] = useState<string | null>(null)

  const shown = useMemo(() => deliveryList?.deliveries ?? [], [deliveryList])
  const summary = deliveryList?.summary
  const cursor = Number(deliveryList?.pagination.cursor ?? 0)
  const limit = deliveryList?.pagination.limit ?? 20
  const rangeLabel = deliveryList?.range ? `この${deliveryList.range.days}日（${jstShortDate(deliveryList.range.from)}〜${jstShortDate(deliveryList.range.to)}）` : 'この30日'
  const undeliveredDetail = summary
    ? [`ブロック ${summary.unmetReasons?.blocked ?? 0}・退会 ${summary.unmetReasons?.unfollowed ?? 0}・その他 ${summary.unmetReasons?.other ?? 0}`, skippedReasonsDetail(summary.skippedReasons as Record<string, number> | undefined)].filter(Boolean).join(' ／ ')
    : null

  const clearFilters = () => {
    setDraft('')
    setAppliedQuery('')
    setFilter('all')
    props.onChangeDeliveryView(undefined, undefined, '')
  }

  const openDetail = (id: string, focusRetry: boolean) => {
    setRetryFocusId(focusRetry ? id : null)
    props.onShowDelivery(retryFocusId === id && deliveryDetail?.id === id ? '' : id)
  }

  return (
    <>
      <div data-design="Note" data-design-node="nen-history-note-v8">
        <NoteBar tone="info">いつ・だれに・何を送ったかの記録です。届かなかったものもここで分かります。{undeliveredDetail ? ` ${undeliveredDetail}。` : ''}</NoteBar>
      </div>

      <div className={styles.tools} data-design="ListControls" data-design-node="nen-history-controls-v8">
        <form
          className={styles.searchGrow}
          onSubmit={(event) => { event.preventDefault(); const q = draft.trim(); setAppliedQuery(q); props.onChangeDeliveryView(historyViewStatus(filter), undefined, q) }}
        >
          <TextField
            aria-label="友だちの名前・配信の名前で検索"
            placeholder="友だちの名前・配信の名前で検索"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
        <span className={styles.rangeLabel}>{rangeLabel}・送った日が新しい順</span>
      </div>
      <div className={styles.tools}>
        {([
          ['all', `すべて ${deliveryList?.pagination.total ?? '—'}`],
          ['sent', `送りました ${summary?.sent ?? '—'}`],
          ['pending', `これから ${summary ? summary.pending + summary.processing : '—'}`],
          ['failed', `届きませんでした ${summary?.failed ?? '—'}`],
          ['skipped', `送りませんでした ${summary?.skipped ?? '—'}`],
        ] as Array<[HistoryFilterV8, string]>).map(([value, label]) => (
          <FilterChip key={value} selected={filter === value} onChange={(selected) => { const next = selected ? value : 'all'; setFilter(next); props.onChangeDeliveryView(historyViewStatus(next), undefined, appliedQuery) }}>{label}</FilterChip>
        ))}
      </div>

      <section data-design="Table" data-design-node="nen-history-table-v8">
        {loading && !deliveryList ? (
          <ListState kind="loading" title="送った履歴を読み込んでいます" />
        ) : tabError ? (
          <ListState
            kind="error"
            title="送った履歴を読み込めませんでした"
            description="通信が切れたか、サーバが応えませんでした。登録した内容は消えていません。"
            onRetry={onRetryTab}
          />
        ) : shown.length === 0 ? (
          filter !== 'all' || appliedQuery ? (
            <ListState
              kind="empty"
              emptyPreset="readonly"
              title="条件に合う履歴はありません"
              description="検索語や絞り込みを変えてください。"
              action={<Button variant="secondary" onClick={clearFilters}>検索と絞り込みを解除</Button>}
            />
          ) : (
            <ListState kind="empty" emptyPreset="readonly" title="送った履歴はまだありません" description="配信が予約されると、送信前からここに記録が並びます。" />
          )
        ) : (
          <div className={styles.tableWrap}>
            <DataTable className="@container">
              <thead>
                <TableHeadRow>
                  <Th>いつ・だれに</Th>
                  <Th>配信</Th>
                  <Th>状態</Th>
                  <Th>きっかけ</Th>
                  <Th align="right">開封</Th>
                  <Th className="w-14" align="right"><span className="sr-only">操作</span></Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {shown.map((delivery) => {
                  const detail = deliveryDetail
                  const open = detail?.id === delivery.id
                  const menuItems: ActionMenuItem[] = [
                    { id: 'detail', label: open ? '中身を閉じる' : '中身を見る', onSelect: () => openDetail(delivery.id, false) },
                    ...(canRetryDelivery(delivery) ? [{ id: 'retry', label: '再送待ちへ戻す', onSelect: () => openDetail(delivery.id, true) }] : []),
                  ]
                  return (
                    <Fragment key={delivery.id}>
                      <Tr>
                        <Td>
                          <span className="block text-label font-semibold tabular-nums text-ink">{formatNenJobDateTime(delivery.sentAt || delivery.scheduledAt)}</span>
                          <span className="block truncate text-micro text-ink-faint" title={`${delivery.friendName || '名前未取得'}・${delivery.lineAccountName}`}>{delivery.friendName || '名前未取得'}・{delivery.lineAccountName}</span>
                        </Td>
                        <Td><span className="text-label text-ink">{delivery.label}</span></Td>
                        <Td>
                          <span className="block text-label font-semibold text-ink">{statusLabel[delivery.status] ?? '状態を確認できません'}</span>
                          {delivery.unmetReason ? <span className="block text-micro text-danger">{delivery.unmetReason}</span> : null}
                        </Td>
                        <Td><span className="text-label text-ink-secondary">{deliveryTriggerLabel(delivery.campaignKey)}</span></Td>
                        <Td align="right"><span className="text-label text-ink-faint" title={delivery.reaction.reason}>取得不可</span></Td>
                        <Td align="right">
                          <RowActions subjectName={delivery.label} menuItems={menuItems} />
                        </Td>
                      </Tr>
                      {open && detail ? (
                        <tr>
                          <td colSpan={6}>
                            <div className={styles.selectPanel}>
                              <p className={styles.selectDesc}>{detail.trigger}</p>
                              <h3 className={styles.selectTitle}>{detail.content.title || detail.label}</h3>
                              <p className={styles.selectDesc}>{detail.content.bodyText || detail.content.reason}</p>
                              {detail.content.buttonLabel ? <p className={styles.selectDesc}>{detail.content.buttonLabel}</p> : null}
                              {canRetryDelivery(delivery) ? (
                                <label className={styles.fieldLabel}>
                                  再送する理由（500文字まで）
                                  <TextArea
                                    value={retryReasons[delivery.id] ?? ''}
                                    onChange={(event) => setRetryReasons((current) => ({ ...current, [delivery.id]: event.target.value }))}
                                    rows={3}
                                    maxLength={500}
                                    autoFocus={retryFocusId === delivery.id}
                                  />
                                  <span className={styles.selectFoot}>
                                    <Button
                                      type="button"
                                      variant="primary"
                                      disabled={!(retryReasons[delivery.id] ?? '').trim()}
                                      onClick={() => props.onRetryDelivery(delivery.id, delivery.version, retryReasons[delivery.id] ?? '')}
                                    >
                                      再送待ちへ戻す
                                    </Button>
                                  </span>
                                </label>
                              ) : delivery.status === 'skipped' ? (
                                <p className={styles.selectDesc}>{skippedNoRetryNote[delivery.unmetReasonCode ?? ''] ?? 'この記録は再送できません。'}</p>
                              ) : (
                                <p className={styles.selectDesc}>再送は最大回数まで失敗した記録と、直せる理由で止まった記録だけ行えます。</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </DataTable>
          </div>
        )}
      </section>
      <div className={styles.listFoot}>
        <ListRange label="記録" total={deliveryList?.pagination.total ?? 0} first={shown.length === 0 ? 0 : cursor + 1} last={shown.length === 0 ? 0 : cursor + shown.length} />
        {deliveryList && (cursor > 0 || deliveryList.pagination.nextCursor) ? (
          <span className={styles.toolsTail}>
            <Button type="button" variant="secondary" disabled={cursor === 0} onClick={() => props.onChangeDeliveryView(historyViewStatus(filter), String(Math.max(0, cursor - limit)), appliedQuery)}>前へ</Button>
            <Button type="button" variant="secondary" disabled={!deliveryList.pagination.nextCursor} onClick={() => props.onChangeDeliveryView(historyViewStatus(filter), deliveryList.pagination.nextCursor ?? undefined, appliedQuery)}>次へ</Button>
          </span>
        ) : null}
      </div>
    </>
  )
}
