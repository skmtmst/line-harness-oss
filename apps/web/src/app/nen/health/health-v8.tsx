'use client'

/*
 * ★V8-B 健康日記（Pencil「★V8-B 画面の地図」専用機能の組：
 * 一覧 `mIwA4`、30日のまとめ `BVuYh`、記録の項目 `z2tvtX`、状態の板 `dzx5D`）。
 *
 * v7（page.tsx 内の HealthInner と health-tab / items-tab /
 * summary-drawer）とは別の部品として持ち、data-theme="v8" のときだけ
 * こちらが出る。データの口（health・healthSummary・印刷）は同じ。
 * 違いは置き場と見せ方だけ——
 * ・数の帯は1枚の白い板に区切り線で4つ（離したカードにしない）。
 * ・道具の段は「ペットを探す」＋よく使う札3つ（気になる変化・今週記録あり・30日記録なし）。
 * ・行末の操作は「…」に集約（30日のまとめ・飼い主を開く）。
 * ・30日のまとめは右から出る引き出し（幅600・幕で暗くする）。
 * ・記録の項目は変えられない決まりの表（z2tvtX）。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Activity, Bell, CalendarCheck, PawPrint } from 'lucide-react'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import FilterChip from '@/components/shared/filter-chip'
import { RowActions } from '@/components/shared/row-actions'
import type { ActionMenuItem } from '@/components/shared/action-menu'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import { TextField } from '@/components/shared/text-field'
import { ApiError } from '@/lib/api'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import { formatNumber } from '@/lib/format'
import {
  headCountLabel,
  nenPetsApi,
  petAnimalTypeLabel,
  type NenHealthChangeFilter,
  type NenHealthKpis,
  type NenHealthLastFilter,
  type NenHealthListData,
  type NenHealthRow,
  type NenHealthSort,
  type NenHealthSummaryData,
} from '@/lib/nen-pets-api'
import { WeightBars } from './health-tab'
import { SummarySheet, SKIN_LABELS, TEAR_LABELS, countText, md } from './summary-drawer'
import type { HealthTabKey } from './page'
import styles from './health-v8.module.css'

type ListStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/** 板ごとの data-design-node（タブで切り替える外枠の印）。 */
const BOARD_NODE: Record<HealthTabKey, string> = {
  logs: 'mIwA4',
  concern: 'mIwA4',
  items: 'z2tvtX',
}

/**
 * 健康日記の V8 画面。外枠（見出し・PDF・タブ・数の帯）は全部のタブで同じ。
 * まとめの取得と印刷は v7 の page.tsx と同じ持ち方（対象スナップショット＋要求世代）。
 */
export default function HealthPageV8({
  accountId,
  tab,
  onChangeTab,
}: {
  accountId: string | null
  tab: HealthTabKey
  onChangeTab: (next: HealthTabKey) => void
}) {
  const [kpis, setKpis] = useState<NenHealthKpis | null>(null)
  const [summaryPetId, setSummaryPetId] = useState<string | null>(null)
  const [summaryStatus, setSummaryStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [summaryError, setSummaryError] = useState<unknown>(null)
  const [summary, setSummary] = useState<{ accountId: string; petId: string; data: NenHealthSummaryData } | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    if (!accountId || !summaryPetId) return
    let active = true
    setSummaryStatus('loading')
    setSummaryError(null)
    void nenPetsApi.healthSummary(accountId, summaryPetId).then((res) => {
      if (!active) return
      if (!res.success) throw new Error(res.error)
      setSummary({ accountId, petId: summaryPetId, data: res.data })
      setSummaryStatus('ready')
    }).catch((caught) => {
      if (!active) return
      setSummaryError(caught)
      setSummaryStatus('error')
    })
    return () => { active = false }
  }, [accountId, summaryPetId, retryNonce])

  const closeSummary = () => {
    setSummaryPetId(null)
    setSummary(null)
    setSummaryError(null)
  }
  const activeSummary = summary && summaryPetId !== null && summary.accountId === accountId && summary.petId === summaryPetId ? summary.data : null
  const canPrint = summaryPetId !== null && summaryStatus === 'ready' && activeSummary !== null

  return (
    <div data-design-node={BOARD_NODE[tab]} className={styles.board}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>健康日記</h1>
          <p className={styles.headDesc}>お客さまがマイページで付けたペットの記録（体重・食事・うんち・元気）を見ます。気になる変化を見つけて声をかけられます。</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => window.print()} disabled={!canPrint} title={canPrint ? undefined : '一覧の「30日のまとめ」を開くと書き出せます'}>獣医師向け PDF を書き出す</Button>
      </div>
      <div data-design="Tabs" data-design-node="health-tabs-v8">
        <Tabs
          items={[
            { label: '記録のあるペット', count: kpis?.petsWithRecords, current: tab === 'logs', onClick: () => onChangeTab('logs') },
            { label: '気になる変化', count: kpis?.concerning, current: tab === 'concern', onClick: () => onChangeTab('concern') },
            { label: '記録の項目', current: tab === 'items', onClick: () => onChangeTab('items') },
          ]}
        />
      </div>

      <HealthKpiBand kpis={kpis} loading={kpis === null && accountId !== null && tab !== 'items'} />

      {!accountId ? (
        <ListState
          kind="empty"
          title="LINEアカウントを選んでください"
          description="上のバーから、記録を見るLINEアカウントを選びます。"
        />
      ) : tab === 'items' ? (
        <HealthItemsV8 />
      ) : (
        <HealthListV8
          key={tab}
          accountId={accountId}
          concernOnly={tab === 'concern'}
          onKpis={setKpis}
          onOpenSummary={setSummaryPetId}
        />
      )}

      {summaryPetId !== null ? (
        <SummaryDrawerV8
          status={summaryStatus}
          summary={activeSummary}
          error={summaryError}
          onClose={closeSummary}
          onRetry={() => setRetryNonce((n) => n + 1)}
          onPrint={() => window.print()}
        />
      ) : null}
      {canPrint ? <SummarySheet summary={activeSummary!} /> : null}
    </div>
  )
}

/**
 * 数の帯。1枚の白い板を区切り線で4つに分ける（★V8 の決まり：
 * 数の帯はカードを離して並べず、白い板の左右いっぱいに置く）。
 */
function HealthKpiBand({
  kpis,
  loading,
}: {
  kpis: NenHealthKpis | null
  loading: boolean
}) {
  const pending = loading || !kpis
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
    <ul className={styles.kpiBand} aria-label="健康日記の数の帯">
      {cell(<PawPrint size={14} />, '記録のあるペット', '記録が付いているペットの数です', pending ? null : kpis!.petsWithRecords, '匹', pending ? ' ' : `今週 記録 ${formatNumber(kpis!.recordsThisWeek)}件`)}
      {cell(<Activity size={14} />, '気になる変化', '体重の±10%の変化・便の異常・食いつき不良が3回続いたペットです', pending ? null : kpis!.concerning, '匹', '体重 ±10%（8週）など')}
      {cell(<CalendarCheck size={14} />, '今週の記録', '直近7日にお客さまが付けた記録です', pending ? null : kpis!.recordsThisWeek, '件', pending ? ' ' : `登録 ${formatNumber(kpis!.petsTotal)}匹のうち`)}
      {cell(<Bell size={14} />, '30日記録なし', '最後の記録から30日以上。注意ではなく「続けるきっかけ」の対象です', pending ? null : kpis!.silent30, '匹', '声をかけられます')}
    </ul>
  )
}

/**
 * 記録のあるペット／気になる変化（mIwA4）。列は今の作りと同じ8列。
 * 道具の段は「ペットを探す」＋よく使う札3つ。行末は「…」に集約。
 */
function HealthListV8({
  accountId,
  concernOnly,
  onKpis,
  onOpenSummary,
}: {
  accountId: string
  concernOnly: boolean
  onKpis: (kpis: NenHealthKpis) => void
  onOpenSummary: (petId: string) => void
}) {
  const [status, setStatus] = useState<ListStatus>('loading')
  const [data, setData] = useState<NenHealthListData | null>(null)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [change, setChange] = useState<NenHealthChangeFilter>(concernOnly ? 'concern' : '')
  const [last, setLast] = useState<NenHealthLastFilter>('')
  const [sort, setSort] = useState<NenHealthSort>('concern')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await nenPetsApi.health(accountId, { q: query, change: concernOnly ? 'concern' : change, last, sort, page })
      if (!res.success) throw new Error(res.error)
      setData(res.data)
      onKpis(res.data.kpis)
      setStatus('ready')
    } catch (caught) {
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId, query, change, concernOnly, last, sort, page, onKpis])

  useEffect(() => {
    void load()
  }, [load])

  const filtering = query !== '' || (!concernOnly && change !== '') || last !== ''
  const resetPage = () => setPage(1)

  return (
    <>
      <div className={styles.tools} data-design="ListControls" data-design-node="health-controls-v8">
        <form
          className={styles.searchGrow}
          onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()); resetPage() }}
        >
          <TextField
            aria-label="ペットを探す"
            placeholder="ペットを探す"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
        {concernOnly ? null : (
          <>
            <FilterChip
              selected={change === 'concern'}
              onChange={(next) => { setChange(next ? 'concern' : ''); resetPage() }}
              count={data?.kpis.concerning}
              title="体重の±10%の変化・便の異常・食いつき不良が3回続いたペットだけ出します"
            >
              気になる変化
            </FilterChip>
            <FilterChip
              selected={last === '7'}
              onChange={(next) => { setLast(next ? '7' : ''); resetPage() }}
              title="7日以内に記録が付いたペットだけ出します"
            >
              今週記録あり
            </FilterChip>
            <FilterChip
              selected={change === 'silent'}
              onChange={(next) => { setChange(next ? 'silent' : ''); resetPage() }}
              count={data?.kpis.silent30}
              title="30日以上 記録のないペットだけ出します"
            >
              30日記録なし
            </FilterChip>
          </>
        )}
        <span className={styles.toolsTail}>
          <Select
            aria-label="よく使う絞り込み"
            value={concernOnly ? 'concern' : change === 'silent' ? '' : change}
            onChange={(value) => { if (!concernOnly) { setChange(value === 'concern' || value === 'none' ? value : ''); resetPage() } }}
            options={[
              { value: '', label: 'よく使う絞り込み' },
              { value: 'concern', label: '気になる変化' },
              { value: 'none', label: '変化なし' },
            ]}
          />
          <span className={styles.rangeLabel}>{data ? headCountLabel(data.total, data.page, data.pageSize) : '—'}</span>
          <Select
            aria-label="並び順"
            value={sort}
            onChange={(value) => { setSort(value as NenHealthSort); resetPage() }}
            options={[
              { value: 'concern', label: '並び：気になる順' },
              { value: 'recent', label: '並び：最終記録が新しい順' },
              { value: 'records_desc', label: '並び：30日の記録が多い順' },
            ]}
          />
        </span>
      </div>

      <div data-design="Note" data-design-node="health-note-v8">
        <NoteBar tone="info">
          「気になる変化」は、体重が8週で±10%以上変わった・便の異常が3回続いた・食いつき不良が3回続いた、のどれかに当てはまるペットです。行の「…」から 30日のまとめを開けます。
        </NoteBar>
      </div>

      <section data-design="Table" data-design-node="health-table-v8">
        {status === 'loading' && !data ? (
          <ListState kind="loading" title="健康日記を読み込んでいます" />
        ) : status === 'forbidden' ? (
          <ListState kind="forbidden" />
        ) : status === 'error' ? (
          <ListState kind="error" title="健康日記を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={() => void load()} />
        ) : data && data.items.length === 0 ? (
          concernOnly || change === 'concern' ? (
            <ListState kind="empty" emptyPreset="readonly" title="気になる変化はありません" description="体重が8週で±10%、便の異常や食いつき不良が3回続くと、ここに並びます。" />
          ) : filtering ? (
            <ListState
              kind="empty"
              title="条件に合うペットはいません"
              description="検索や絞り込みを外すと、すべて出ます。"
              action={<Button variant="secondary" onClick={() => { setQuery(''); setDraft(''); setChange(''); setLast(''); resetPage() }}>条件を外す</Button>}
            />
          ) : (
            <ListState kind="empty" emptyPreset="readonly" title="まだ記録がありません" description="お客さまがマイページで健康日記を付けると、ここに並びます。" />
          )
        ) : data ? (
          <>
            <div className={styles.tableWrap}>
              <DataTable className="@container">
                <thead>
                  <TableHeadRow>
                    <Th>ペット</Th>
                    <Th>飼い主</Th>
                    <Th>最終記録</Th>
                    <Th align="right">30日の記録</Th>
                    <Th>体重の推移（8週）</Th>
                    <Th>便・食いつき</Th>
                    <Th>気になる変化</Th>
                    <Th className="w-14" align="right"><span className="sr-only">操作</span></Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <HealthRowV8 key={row.pet.id} row={row} onOpenSummary={onOpenSummary} />
                  ))}
                </tbody>
              </DataTable>
            </div>
            <div className={styles.listFoot}>
              <ListRange
                total={data.total}
                first={data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1}
                last={Math.min(data.total, data.page * data.pageSize)}
              />
              {data.total > data.pageSize ? (
                <Pagination
                  page={data.page}
                  pageCount={Math.max(1, Math.ceil(data.total / data.pageSize))}
                  onPageChange={setPage}
                />
              ) : null}
            </div>
            <p className={styles.listHint}>行の「…」から 30日のまとめ・飼い主を開く。</p>
          </>
        ) : null}
      </section>
    </>
  )
}

function HealthRowV8({ row, onOpenSummary }: { row: NenHealthRow; onOpenSummary: (petId: string) => void }) {
  const initial = (row.pet.name || '?').slice(0, 1)
  const kind = petAnimalTypeLabel(row.pet.animalType)
  const name = row.pet.callName || row.pet.name || '（名前なし）'
  const weightWarn = row.changes.some((c) => c.key === 'weight_drop' || c.key === 'weight_gain')
  const menuItems: ActionMenuItem[] = [
    { id: 'summary', label: '30日のまとめ', onSelect: () => onOpenSummary(row.pet.id) },
    { id: 'owner', label: '飼い主を開く', external: true, onSelect: () => { window.location.href = `/friends/detail?id=${encodeURIComponent(row.owner.friendId)}` } },
  ]
  return (
    <Tr>
      <Td>
        <span className="flex items-center gap-3">
          {row.pet.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- お客様がマイページで登録した写真
            <img src={row.pet.imageUrl} alt="" className={styles.petFace} />
          ) : (
            <span aria-hidden="true" className={styles.petFace}>{initial}</span>
          )}
          <span className="min-w-0">
            <span className={styles.petName} title={row.pet.callName}>{name}</span>
            <span className={styles.petSub}>{row.pet.ageLabel === '—' ? kind : `${kind}・${row.pet.ageLabel}`}</span>
          </span>
        </span>
      </Td>
      <Td><span className="block truncate text-label text-ink" title={row.owner.name}>{row.owner.name || '（名前なし）'}</span></Td>
      <Td><span className="text-label text-ink-secondary">{row.lastLoggedLabel}</span></Td>
      <Td align="right"><span className="text-label tabular-nums text-ink">{row.count30d}日</span></Td>
      <Td><WeightBars series={row.weightSeries} warn={weightWarn} /></Td>
      <Td><span className="text-label text-ink-secondary">{row.latestStool && row.latestAppetite ? `${row.latestStool}・${row.latestAppetite}` : '—'}</span></Td>
      <Td>
        {row.changes.length === 0 ? (
          row.count30d > 0 ? <Chip tone="ok">いつもどおり</Chip> : <Chip tone="neutral">記録なし</Chip>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.changes.map((c) => <Chip key={c.key} tone={c.tone === 'warn' ? 'warn' : 'neutral'}>{c.label}</Chip>)}
          </span>
        )}
      </Td>
      <Td align="right">
        <RowActions subjectName={name} menuItems={menuItems} />
      </Td>
    </Tr>
  )
}

/**
 * 項目ごとの 記録の形・選べる値・「気になる変化」に出る条件・
 * 30日のまとめでの扱い（z2tvtX。変えられない決まりの一覧）。
 */
const ITEM_ROWS: Array<{ item: string; shape: string; values: string; condition: string; summary: string }> = [
  { item: '体重', shape: '数値（kg）', values: '—', condition: '直近8週の週平均で、最初と最後の週を比べて ±10% 以上', summary: '「今日の目安」の元' },
  { item: '便', shape: '選ぶ', values: '正常／やわらかい／かたい／下痢／血が混じる／その他', condition: '直近3回がすべて下痢または血が混じる', summary: '回数を出す' },
  { item: '食いつき', shape: '選ぶ', values: '良い／ふつう／不良', condition: '直近3回がすべて不良', summary: '回数を出す' },
  { item: '皮膚', shape: '選ぶ', values: '問題なし／かゆそう／赤み／その他', condition: '—', summary: '回数を出す' },
  { item: '涙やけ', shape: '選ぶ', values: '問題なし／少し気になる／気になる', condition: '—', summary: '回数を出す' },
  { item: '呼吸数', shape: '数値（回／分）', values: '—', condition: '—', summary: '平均を出す' },
  { item: '心拍数', shape: '数値（回／分）', values: '—', condition: '—', summary: '平均を出す' },
  { item: 'メモ', shape: '文字', values: '—', condition: '—', summary: '新しい順で最大 20 件' },
  { item: '記録なし', shape: '—', values: '—', condition: '最後の記録から 30 日以上（注意ではなく、続けるきっかけ）', summary: '—' },
]

function HealthItemsV8() {
  return (
    <section data-design="Table" data-design-node="health-items-table-v8">
      <div className={styles.tableWrap}>
        <DataTable className="@container">
          <thead>
            <TableHeadRow>
              <Th>項目</Th>
              <Th>記録の形</Th>
              <Th>選べる値</Th>
              <Th>「気になる変化」に出る条件</Th>
              <Th>30日のまとめ</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {ITEM_ROWS.map((row) => (
              <Tr key={row.item}>
                <Td><span className="text-label font-semibold text-ink">{row.item}</span></Td>
                <Td><span className="text-label text-ink-secondary">{row.shape}</span></Td>
                <Td><span className="text-label text-ink-secondary">{row.values}</span></Td>
                <Td><span className="text-label text-ink-secondary">{row.condition}</span></Td>
                <Td><span className="text-label text-ink-secondary">{row.summary}</span></Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </div>
      <p className={styles.itemsNote}>項目と条件は決まっていて、ここでは変えられません。お客さまのマイページの記録と同じ並びです</p>
    </section>
  )
}

/**
 * 30日のまとめ（BVuYh）。一覧の上に右から出る引き出し（幅600・幕で暗くする）。
 * 記録日数・体重・呼吸数・心拍数、体重の30日の棒、記録の表、
 * 印刷・PDF に保存する。「診断や治療の判断は含みません」の注意。
 * PDFボタンがブラウザ印刷（window.print）であることを注記する。
 */
function SummaryDrawerV8({
  status,
  summary,
  error,
  onClose,
  onRetry,
  onPrint,
}: {
  status: 'loading' | 'ready' | 'error'
  summary: NenHealthSummaryData | null
  error?: unknown
  onClose: () => void
  onRetry: () => void
  onPrint: () => void
}) {
  const s = summary?.summary
  const petLine = summary
    ? `${summary.pet.callName || summary.pet.name}（${petAnimalTypeLabel(summary.pet.animalType)}・${summary.pet.breed || '品種未登録'}・${summary.pet.ageLabel}）・${summary.owner.name}さん`
    : ''
  const weightDelta = s?.weight ? s.weight.last - s.weight.first : null
  const weightDeltaPercent = s?.weight && s.weight.first !== 0 ? Math.round((weightDelta! / s.weight.first) * 100) : null

  return (
    <div data-design-node="BVuYh">
      <div className={styles.drawerScrim} onClick={onClose} aria-hidden="true" />
      <div className={styles.drawerPanel} role="dialog" aria-modal="true" aria-label="健康日記 30日のまとめ">
        <div className={styles.drawerHead}>
          <div>
            <h2 className={styles.drawerTitle}>健康日記 30日のまとめ</h2>
            <p className={styles.drawerSub}>{status === 'loading' ? 'まとめを作っています' : petLine}</p>
          </div>
          <button type="button" className={styles.drawerClose} onClick={onClose} aria-label="閉じる">✕</button>
        </div>
        {status === 'loading' ? (
          <ListState kind="loading" title="まとめを作っています" />
        ) : status === 'error' || !summary || !s ? (
          <ListState
            kind="error"
            title="まとめを作れませんでした"
            description={isForbiddenOrRateLimited(error) ? undefined : '通信の状態を確認して、もう一度お試しください。'}
            error={error ?? undefined}
            onRetry={onRetry}
          />
        ) : (
          <>
            <p className={styles.drawerNote}>お客さまがマイページで付けた記録をまとめたものです。診断や治療の判断は含みません。</p>
            <dl className={styles.statGrid}>
              <div className={styles.statBox}>
                <dt className={styles.statLabel}>記録</dt>
                <dd className={styles.statValue}>{s.records}日</dd>
              </div>
              <div className={styles.statBox}>
                <dt className={styles.statLabel}>体重</dt>
                <dd className={styles.statValue}>{s.weight ? `${s.weight.first} → ${s.weight.last} kg` : '—'}</dd>
              </div>
              <div className={styles.statBox}>
                <dt className={styles.statLabel}>呼吸数（平均）</dt>
                <dd className={styles.statValue}>{s.respiratoryRateAvg == null ? '—' : `${s.respiratoryRateAvg}回／分`}</dd>
              </div>
              <div className={styles.statBox}>
                <dt className={styles.statLabel}>心拍数（平均）</dt>
                <dd className={styles.statValue}>{s.heartRateAvg == null ? '—' : `${s.heartRateAvg}回／分`}</dd>
              </div>
            </dl>
            <section aria-label="体重の30日の推移">
              <div className={styles.chartHead}>
                <h3 className={styles.chartTitle}>体重</h3>
                {weightDelta !== null && weightDeltaPercent !== null ? (
                  <p className={styles.chartCaption}>30日で{weightDelta > 0 ? `＋${weightDelta.toFixed(1)}` : weightDelta.toFixed(1)}kg（{weightDeltaPercent > 0 ? `＋${weightDeltaPercent}` : weightDeltaPercent}%）</p>
                ) : null}
              </div>
              <WeightChart30d logs={s.logs} />
            </section>
            <section aria-label="記録の表">
              <div className={styles.tableWrap}>
                <DataTable>
                  <thead>
                    <TableHeadRow>
                      <Th>日付</Th>
                      <Th align="right">体重</Th>
                      <Th>便</Th>
                      <Th>食いつき</Th>
                      <Th>皮膚</Th>
                      <Th>涙やけ</Th>
                      <Th>メモ</Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {s.logs.map((log) => (
                      <Tr key={log.loggedOn}>
                        <Td><span className="text-label tabular-nums text-ink">{md(log.loggedOn)}</span></Td>
                        <Td align="right"><span className="text-label tabular-nums text-ink">{log.weightKg == null ? '—' : `${log.weightKg}kg`}</span></Td>
                        <Td><span className="text-label text-ink-secondary">{summary.labels.stool[log.stool] ?? log.stool}</span></Td>
                        <Td><span className="text-label text-ink-secondary">{summary.labels.appetite[log.appetite] ?? log.appetite}</span></Td>
                        <Td><span className="text-label text-ink-secondary">{log.skin ? SKIN_LABELS[log.skin] ?? log.skin : '—'}</span></Td>
                        <Td><span className="text-label text-ink-secondary">{log.tearStain ? TEAR_LABELS[log.tearStain] ?? log.tearStain : '—'}</span></Td>
                        <Td><span className="block truncate text-label text-ink-secondary" title={s.notes.find((n) => n.loggedOn === log.loggedOn)?.note ?? ''}>{s.notes.find((n) => n.loggedOn === log.loggedOn)?.note ?? '—'}</span></Td>
                      </Tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
            </section>
            <p className={styles.itemsNote}>便・食いつき：{countText(s.stool, summary.labels.stool)}／{countText(s.appetite, summary.labels.appetite)}</p>
            <div className={styles.drawerFoot}>
              <Button type="button" variant="secondary" onClick={onPrint} title="ブラウザの印刷で PDF に保存します">印刷・PDF に保存する</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * 体重の30日の棒。記録のある日の体重だけ棒にし、無い日は薄い線。
 * 最小〜最大の幅で高さを決める。棒の上は丸めない。
 */
function WeightChart30d({ logs }: { logs: NenHealthSummaryData['summary']['logs'] }) {
  const byDay = new Map<string, number>()
  for (const log of logs) {
    if (log.weightKg != null && !byDay.has(log.loggedOn)) byDay.set(log.loggedOn, log.weightKg)
  }
  const days: Array<{ key: string; value: number | null }> = []
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.push({ key, value: byDay.get(key) ?? null })
  }
  const known = days.map((d) => d.value).filter((v): v is number => v != null)
  const min = known.length ? Math.min(...known) : 0
  const max = known.length ? Math.max(...known) : 0
  const label = known.length >= 2 ? `${known[0]}kg → ${known[known.length - 1]}kg` : known.length === 1 ? `${known[0]}kg` : '記録なし'
  return (
    <div className={styles.chartBars} role="img" aria-label={`体重の推移（30日）：${label}`} title={label}>
      {days.map((day) => day.value == null ? (
        <span key={day.key} className={styles.chartBarEmpty} />
      ) : (
        <span key={day.key} className={styles.chartBar} style={{ height: `${max === min ? 60 : 30 + Math.round(((day.value - min) / (max - min)) * 70)}%` }} title={`${day.key.slice(5).replace('-', '/')} ${day.value}kg`} />
      ))}
    </div>
  )
}
