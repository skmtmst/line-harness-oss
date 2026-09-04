'use client'

import SelectField from '@/components/shared/select-field'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import Button from '@/components/shared/button'
import Pagination from '@/components/shared/pagination'
import ListState from '@/components/shared/list-state'
import { webinarLoadFailure, type WebinarLoadFailure } from './webinar-load-failure'
import { useAccount } from '@/contexts/account-context'
import { ApiError, webinarApi, type Webinar } from '@/lib/api'

const STATUS_LABEL: Record<Webinar['status'], string> = {
  draft: '下書き', active: '公開中', archived: 'アーカイブ',
}

const STATUS_BADGE: Record<Webinar['status'], string> = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
}

function scheduleSummary(w: Webinar): string {
  if (w.schedule.length === 0) return '未設定'
  const DAYS = ['日', '月', '火', '水', '木', '金', '土']
  const dailyTimes = w.schedule
    .filter((rule) => rule.type === 'daily' && rule.time)
    .map((rule) => rule.time as string)
    .sort()
  const otherRules = w.schedule.filter((rule) => rule.type !== 'daily')
  const parts: string[] = []
  if (dailyTimes.length > 0) {
    const toMinutes = (time: string) => {
      const [hours, minutes] = time.split(':').map(Number)
      return hours * 60 + minutes
    }
    const intervals = dailyTimes.slice(1).map((time, index) => toMinutes(time) - toMinutes(dailyTimes[index]))
    const interval = intervals.length > 0 && intervals.every((value) => value === intervals[0]) ? intervals[0] : null
    parts.push(
      dailyTimes.length === 1
        ? `毎日 ${dailyTimes[0]}`
        : `毎日 ${dailyTimes[0]}〜${dailyTimes[dailyTimes.length - 1]}${interval ? `・${interval}分間隔` : ''}（${dailyTimes.length}枠）`,
    )
  }
  otherRules.forEach((rule) => {
    if (rule.type === 'weekly') parts.push(`毎週${(rule.days ?? []).map((day) => DAYS[day]).join('・')} ${rule.time}`)
    if (rule.type === 'once') parts.push(rule.at ? new Date(rule.at).toLocaleString('ja-JP') : '単発・日時未設定')
  })
  return parts.join(' / ')
}

type SortKey = 'updated' | 'created' | 'name'
type SavedFilter = '' | 'active' | 'draft'

export default function WebinarsPage() {
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const requestGeneration = useRef(0)
  const [items, setItems] = useState<Webinar[]>([])
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [savedFilter, setSavedFilter] = useState<SavedFilter>('')
  const [loading, setLoading] = useState(true)
  const [loadFailure, setLoadFailure] = useState<WebinarLoadFailure | null>(null)

  const visibleItems = loadedAccountId === selectedAccountId ? items : []

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current
    if (!selectedAccountId) {
      setItems([])
      setLoadedAccountId(null)
      setLoadFailure(null)
      setLoading(false)
      return
    }
    const accountId = selectedAccountId
    setLoading(true)
    setItems([])
    setLoadedAccountId(null)
    setLoadFailure(null)
    try {
      const res = await webinarApi.list(accountId)
      if (requestGeneration.current !== generation) return
      /*
        **配列で来なかったら、そこで止める。**
        口の契約は配列（`apps/worker/src/routes/webinars.ts` は
        `data: items.results.map(serializeWebinar)` を返す）だが、器だけが
        違う返事（`{items:[],total:0}` など）が来ると `[...narrowed]` で
        `narrowed is not iterable` になり、**一覧が白い画面になる**。
        読めなかったこととして扱えば、理由と読み直しの口が出る。
      */
      if (!Array.isArray(res.data)) throw new ApiError(500, 'ウェビナーの一覧が読めない形で返りました')
      setItems(res.data)
      setLoadedAccountId(accountId)
    } catch (err) {
      if (requestGeneration.current === generation) setLoadFailure(webinarLoadFailure(err))
    } finally {
      if (requestGeneration.current === generation) setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** 数を出してよいのは、読めたときだけ。 */
  const hasListData = !accountLoading && !loading && loadFailure === null && Boolean(selectedAccountId)

  const filtered = useMemo(() => {
    // タイトルと slug の両方を見る。URLで探すこともあるため。
    const q = query.trim()
    const searched = q
      ? visibleItems.filter((w) => w.title.includes(q) || w.slug.includes(q))
      : visibleItems
    const narrowed = savedFilter
      ? searched.filter((w) => w.status === savedFilter)
      : searched
    return [...narrowed].sort((a, b) => {
      if (sortKey === 'name') return a.title.localeCompare(b.title, 'ja')
      if (sortKey === 'created') return b.createdAt.localeCompare(a.createdAt)
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [visibleItems, query, savedFilter, sortKey])

  useEffect(() => {
    setPage(1)
  }, [query, savedFilter, sortKey, pageSize, selectedAccountId])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleStart = (currentPage - 1) * pageSize
  const visible = filtered.slice(visibleStart, visibleStart + pageSize)

  return (
    <>
      <div data-design="Head">
        <Header
          title="ウェビナー"
          description="動画セミナーの申込から視聴、視聴後のフォロー配信までを管理します。"
          action={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/webinars/new"
                className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium"
              >
                ウェビナーを作成
              </Link>
              <button
                disabled
                title="マニュアルは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
              >
                マニュアル
              </button>
            </div>
          }
        />
      </div>

      <div data-design="KPIs" className="mx-auto mb-4 grid max-w-6xl grid-cols-1 gap-4 px-6 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">ウェビナー</p>
          {/*
            **読めていないときに 0 件と書かない。** 「1つも無い」と
            「読めなかった」は別のことで、0 と出すと消えたように見える。
            数が無いときは `—`（単位も付けない。`—件` は数に見える）。
          */}
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {hasListData ? visibleItems.length : '—'}
            {hasListData && <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            公開中 {hasListData ? visibleItems.filter((w) => w.status === 'active').length : '—（未取得）'}
          </p>
        </div>
        {/* 申込・視聴の集計を返す口が無い。個別のウェビナーを開けば見られるが、
            一覧でまとめて数える経路を持っていない。 */}
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">申込</p>
          <p className="text-ink-faint mt-1 text-2xl font-bold">—</p>
          <p className="text-ink-faint mt-0.5 text-xs">一覧では数えられません</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">平均視聴率</p>
          <p className="text-ink-faint mt-1 text-2xl font-bold">—</p>
          <p className="text-ink-faint mt-0.5 text-xs">申込者のうち</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">平均視聴時間</p>
          <p className="text-ink-faint mt-1 text-2xl font-bold">—</p>
          <p className="text-ink-faint mt-0.5 text-xs">視聴ログの集計は未対応</p>
        </div>
      </div>
      <div className="p-6 max-w-6xl mx-auto">
        <div
          data-design="Bar"
          className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ウェビナー名で検索"
            aria-label="ウェビナー名で検索"
            className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
          <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
          <SelectField value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} aria-label="並び順" options={[{ value: "updated", label: "更新が新しい順" }, { value: "created", label: "作成が新しい順" }, { value: "name", label: "名前順" }]} className="border-hairline rounded-control border px-2 py-2 text-sm" />
          <span className="text-ink-faint text-xs whitespace-nowrap">表示</span>
          <SelectField
            size="compact"
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
            aria-label="表示件数"
            options={[
              { value: '20', label: '20件表示' },
              { value: '50', label: '50件表示' },
              { value: '100', label: '100件表示' },
            ]}
          />
        </div>

        <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-ink-faint text-xs whitespace-nowrap">保存した条件</span>
          {([
            { key: 'active', label: '公開中のみ' },
            { key: 'draft', label: '下書きのみ' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSavedFilter(savedFilter === key ? '' : key)}
              aria-pressed={savedFilter === key}
              className={`rounded-pill border px-3 py-1 text-xs transition-colors ${
                savedFilter === key
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {accountLoading || loading ? (
          <ListState kind="loading" />
        ) : !selectedAccountId ? (
          <div className="bg-canvas rounded-card border-hairline border p-12 text-center">
            <div className="text-ink font-medium">
              {accounts.length > 0
                ? '上のバーでLINE公式アカウントを選んでください'
                : 'LINE公式アカウントが登録されていません'}
            </div>
          </div>
        ) : loadFailure ? (
          /*
            権限不足と読み込み失敗を1枚ずつ言い分ける。**押しても直らない
            ときは読み直しの口を出さない。**
          */
          <ListState
            kind={loadFailure.kind}
            title={loadFailure.title}
            description={loadFailure.description}
            action={loadFailure.retryable ? <Button onClick={() => void refresh()}>もう一度読み込む</Button> : undefined}
          />
        ) : visibleItems.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <div className="text-gray-700 font-medium mb-2">ウェビナーがまだありません</div>
            <p className="text-sm text-gray-500 mb-4">
              録画動画をアップロードしてスケジュールを設定すると、友だちが毎回「今始まったばかり」の疑似ライブとして視聴できます。
            </p>
            <Link
              href="/webinars/new"
              className="inline-block px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              最初のウェビナーを作成
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-canvas rounded-card border-hairline border p-12 text-center">
            <div className="text-ink font-medium">条件に合うウェビナーはありません</div>
            <p className="text-ink-faint mt-2 text-sm">検索文字か保存した条件を変えてください。</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {visible.map((w) => (
              <Link
                key={w.id}
                href={`/webinars/edit?id=${w.id}`}
                className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
              >
                <div className="flex items-start gap-4 p-5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
                    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2"><path d="M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="line-clamp-2 font-bold leading-6 text-slate-900 group-hover:text-blue-700">{w.title}</h2>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_BADGE[w.status]}`}>{STATUS_LABEL[w.status]}</span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{scheduleSummary(w)}</p>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                      <span className="font-mono text-[11px] text-slate-400">/{w.slug}</span>
                      <span className="text-xs font-semibold text-blue-600">概要・分析を見る →</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
        {hasListData && filtered.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink-faint text-xs tabular-nums">
              {visibleStart + 1}〜{Math.min(visibleStart + pageSize, filtered.length)}件 / 全{filtered.length}件
            </p>
            <Pagination
              page={currentPage}
              pageCount={pageCount}
              onPageChange={setPage}
              ariaLabel="ウェビナー一覧のページ送り"
            />
          </div>
        )}
      </div>
    </>
  )
}
