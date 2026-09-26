'use client'

import { useCallback, useEffect, useState } from 'react'
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import SummaryCard from '@/components/shared/summary-card'
import KpiCollapse from '@/components/ui/kpi-collapse'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import { ApiError } from '@/lib/api'
import {
  headCountLabel, nenPetsApi, petAnimalTypeLabel, type NenHealthChangeFilter, type NenHealthKpis, type NenHealthLastFilter, type NenHealthListData, type NenHealthRow, type NenHealthSort,
} from '@/lib/nen-pets-api'

type ListStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/**
 * 記録のあるペット／気になる変化 タブ。★V6 37-4（`mtoCA`）。
 * 列：ペット／飼い主／最終記録／30日の記録／体重の推移（8週）／便・食いつき／気になる変化／30日のまとめ。
 * 「気になる変化」タブは同じ一覧を「変化：気になる」で固定して出す。
 */
export default function HealthTab({
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

  const kpis = data?.kpis ?? null
  const ready = status === 'ready' && kpis !== null
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <>
      <KpiCollapse data-design="KPIs" data-design-node="health-kpis" gridClassName="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard variant="v6" title="今週の記録" value={ready ? kpis!.recordsThisWeek : null} unit="件" detail="" help="直近7日にお客様が付けた記録です" loading={!ready && status === 'loading'} />
        <SummaryCard variant="v6" title="記録しているペット" value={ready ? kpis!.petsWithRecords : null} unit="頭" detail={ready ? `登録 ${kpis!.petsTotal.toLocaleString('ja-JP')}頭のうち` : '—'} loading={!ready && status === 'loading'} />
        <SummaryCard variant="v6" title="気になる変化" value={ready ? kpis!.concerning : null} unit="頭" detail="" help="体重の±10%の変化・便の異常・食いつき不良が3回続いたペットです" loading={!ready && status === 'loading'} />
        <SummaryCard variant="v6" title="30日以上 記録なし" value={ready ? kpis!.silent30 : null} unit="頭" detail="続けるきっかけを配信できる" loading={!ready && status === 'loading'} />
      </KpiCollapse>

      <div data-design="Note" data-design-node="health-note">
        <NoteBar tone="info">
          記録はお客様がマイページで付けます（体重・心拍・呼吸・便・食いつき・皮膚・涙やけ・メモ）。ここでは変化に気づくための一覧と、診察時に獣医師へ見せる「30日のまとめ」を出します。診断や治療の判断はしません。
        </NoteBar>
      </div>

      <div data-design="ListControls" data-design-node="health-controls" className="flex flex-wrap items-center gap-3">
        <form
          className="min-w-64 flex-1"
          onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()); setPage(1) }}
        >
          <TextField
            aria-label="ペットを検索"
            placeholder="ペット名・飼い主で検索"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
        {concernOnly ? null : (
          <Select
            aria-label="変化で絞り込む"
            value={change}
            onChange={(value) => { setChange(value === 'concern' || value === 'silent' || value === 'none' ? value : ''); setPage(1) }}
            options={[
              { value: '', label: '変化：すべて' },
              { value: 'concern', label: '変化：気になる' },
              { value: 'silent', label: '変化：30日以上 記録なし' },
              { value: 'none', label: '変化：なし' },
            ]}
          />
        )}
        <Select
          aria-label="最終記録で絞り込む"
          value={last}
          onChange={(value) => { setLast(value === '7' || value === '30' || value === 'over30' ? value : ''); setPage(1) }}
          options={[
            { value: '', label: '最終記録：すべて' },
            { value: '7', label: '最終記録：7日以内' },
            { value: '30', label: '最終記録：30日以内' },
            { value: 'over30', label: '最終記録：30日より前' },
          ]}
        />
        <Select
          aria-label="並び順"
          value={sort}
          onChange={(value) => { setSort(value as NenHealthSort); setPage(1) }}
          options={[
            { value: 'concern', label: '並び：気になる順' },
            { value: 'recent', label: '並び：最終記録が新しい順' },
            { value: 'records_desc', label: '並び：30日の記録が多い順' },
          ]}
        />
        <span className="ml-auto text-caption font-semibold text-ink-faint">
          {data ? headCountLabel(data.total, data.page, data.pageSize) : '—'}
        </span>
      </div>

      <section data-design="Table" data-design-node="health-table">
        {status === 'loading' && !data ? (
          <ListState kind="loading" title="健康日記を読み込んでいます" />
        ) : status === 'forbidden' ? (
          <ListState kind="forbidden" />
        ) : status === 'error' ? (
          <ListState kind="error" title="健康日記を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={() => void load()} />
        ) : data && data.items.length === 0 ? (
          concernOnly ? (
            <ListState kind="empty" emptyPreset="readonly" title="気になる変化はありません" description="体重が8週で±10%、便の異常や食いつき不良が3回続くと、ここに並びます。" />
          ) : (
            <ListState kind="empty" emptyPreset="readonly" title="まだ記録がありません" description="お客様がマイページで健康日記を付けると、ここに並びます。" />
          )
        ) : data ? (
          <>
            <DataTable>
              <thead>
                <TableHeadRow>
                  <Th className="w-56">ペット</Th>
                  <Th className="w-36">飼い主</Th>
                  <Th className="w-24">最終記録</Th>
                  <Th className="w-24" align="right">30日の記録</Th>
                  <Th className="w-40">体重の推移（8週）</Th>
                  <Th className="w-36">便・食いつき</Th>
                  <Th>気になる変化</Th>
                  <Th className="w-28" align="right"><span className="sr-only">操作</span></Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {data.items.map((row) => <HealthRow key={row.pet.id} row={row} onOpenSummary={onOpenSummary} />)}
              </tbody>
            </DataTable>
            {pageCount > 1 ? <Pagination page={data.page} pageCount={pageCount} onPageChange={setPage} /> : null}
          </>
        ) : null}
      </section>
    </>
  )
}

/** 8週の週平均体重を小さな棒で。最小〜最大の幅で高さを決め、記録の無い週は薄い線。 */
function WeightBars({ series, warn }: { series: Array<number | null>; warn: boolean }) {
  const known = series.filter((v): v is number => v != null)
  const min = known.length ? Math.min(...known) : 0
  const max = known.length ? Math.max(...known) : 0
  const label = known.length >= 2 ? `${known[0]}kg → ${known[known.length - 1]}kg` : known.length === 1 ? `${known[0]}kg` : '記録なし'
  return (
    <span className="inline-flex h-6 items-end gap-0.5" role="img" aria-label={`体重の推移（8週）：${label}`} title={label}>
      {series.map((value, index) => value == null ? (
        <span key={index} className="h-0.5 w-2 rounded-pill bg-hairline" />
      ) : warn ? (
        <span key={index} className="w-2 rounded-t-sm bg-status-warn" style={{ height: `${max === min ? 60 : 30 + Math.round(((value - min) / (max - min)) * 70)}%` }} />
      ) : (
        <span key={index} className="w-2 rounded-t-sm bg-accent" style={{ height: `${max === min ? 60 : 30 + Math.round(((value - min) / (max - min)) * 70)}%` }} />
      ))}
    </span>
  )
}

function HealthRow({ row, onOpenSummary }: { row: NenHealthRow; onOpenSummary: (petId: string) => void }) {
  const initial = (row.pet.name || '?').slice(0, 1)
  // #999 DEEP-24: 「その他」を犬へ変換しない（共通の動物種別ラベル）。
  const kind = petAnimalTypeLabel(row.pet.animalType)
  const weightWarn = row.changes.some((c) => c.key === 'weight_drop' || c.key === 'weight_gain')
  return (
    <Tr>
      <Td>
        <span className="flex items-center gap-3">
          {row.pet.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- お客様がマイページで登録した写真
            <img src={row.pet.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-pill object-cover" />
          ) : (
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-caption font-bold text-accent-deep">{initial}</span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-label font-semibold text-ink" title={row.pet.callName}>{row.pet.callName || row.pet.name || '（名前なし）'}</span>
            <span className="block truncate text-micro text-ink-faint">{row.pet.ageLabel === '—' ? kind : `${kind}・${row.pet.ageLabel}`}</span>
          </span>
        </span>
      </Td>
      <Td><span className="block truncate text-label text-ink" title={row.owner.name}>{row.owner.name || '（名前なし）'}</span></Td>
      <Td><span className="text-label text-ink-secondary">{row.lastLoggedLabel}</span></Td>
      <Td align="right"><span className="text-label tabular-nums text-ink">{row.count30d}件</span></Td>
      <Td><WeightBars series={row.weightSeries} warn={weightWarn} /></Td>
      <Td><span className="text-label text-ink-secondary">{row.latestStool && row.latestAppetite ? `${row.latestStool}・${row.latestAppetite}` : '—'}</span></Td>
      <Td>
        {row.changes.length === 0 ? (
          <span className="text-label text-ink-faint">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.changes.map((c) => <Chip key={c.key} tone={c.tone === 'warn' ? 'warn' : 'neutral'}>{c.label}</Chip>)}
          </span>
        )}
      </Td>
      <Td align="right">
        <button type="button" onClick={() => onOpenSummary(row.pet.id)} className="text-label font-semibold text-action">30日のまとめ</button>
      </Td>
    </Tr>
  )
}
