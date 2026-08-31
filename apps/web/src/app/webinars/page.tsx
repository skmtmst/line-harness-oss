'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import Button from '@/components/shared/button'
import ListState, { type ListStateKind } from '@/components/shared/list-state'
import { ApiError, webinarApi, type Webinar, type WebinarOverview } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { overviewCards } from './overview-view'

const STATUS_LABEL: Record<Webinar['status'], string> = {
  draft: '下書き', active: '公開中', archived: 'アーカイブ',
}

const STATUS_BADGE: Record<Webinar['status'], string> = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
}

type WebinarLoadFailure = {
  kind: Extract<ListStateKind, 'error' | 'forbidden'>
  title: string
  description: string
}

function webinarLoadFailure(error: unknown): WebinarLoadFailure {
  if (error instanceof ApiError && error.status === 403) {
    return {
      kind: 'forbidden',
      title: 'ウェビナーを見る権限がありません',
      description: 'このLINEアカウントを見る権限を、オーナーか管理者に確認してください。',
    }
  }
  if (error instanceof ApiError && error.status === 429) {
    return {
      kind: 'error',
      title: 'ウェビナーの読み込みが混み合っています',
      description: '少し待ってから、もう一度読み込んでください。',
    }
  }
  return {
    kind: 'error',
    title: 'ウェビナーを表示できませんでした',
    description: '通信状態を確認して、もう一度読み込んでください。',
  }
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

export default function WebinarsPage() {
  const [items, setItems] = useState<Webinar[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadFailure, setLoadFailure] = useState<WebinarLoadFailure | null>(null)
  const { selectedAccountId } = useAccount()
  const [overview, setOverview] = useState<WebinarOverview | null>(null)
  const [overviewFailure, setOverviewFailure] = useState<WebinarLoadFailure | null>(null)

  /* 遅い返事を別のアカウントへ映さない。切り替えた時点で世代を進める。 */
  const overviewRef = useRef<{ accountId: string | null; generation: number }>({
    accountId: null, generation: 0,
  })

  const refreshOverview = useCallback(async () => {
    /*
      **アカウントを切り替えたら、前の集計はその場で捨てる。**
      読み終わるまで前の数字を残すと、別のアカウントの数を見たまま
      操作することになる。
    */
    setOverview(null)
    setOverviewFailure(null)
    overviewRef.current = {
      accountId: selectedAccountId, generation: overviewRef.current.generation + 1,
    }
    const at = { ...overviewRef.current }
    const stillHere = () =>
      overviewRef.current.accountId === at.accountId
      && overviewRef.current.generation === at.generation
    if (!selectedAccountId) return
    try {
      const res = await webinarApi.overview(selectedAccountId)
      if (!stillHere()) return
      setOverview(res.data)
    } catch (e) {
      if (!stillHere()) return
      /* 失敗を0件にしない。帯ごと失敗として描く。 */
      setOverviewFailure(webinarLoadFailure(e))
    }
  }, [selectedAccountId])

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadFailure(null)
    try {
      const res = await webinarApi.list()
      setItems(res.data)
    } catch (e) {
      setLoadFailure(webinarLoadFailure(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void refreshOverview()
  }, [refreshOverview])

  // タイトルと slug の両方を見る。URLで探すこともあるため。
  const q = query.trim()
  const shown = q ? items.filter((w) => w.title.includes(q) || w.slug.includes(q)) : items
  const hasListData = !loading && loadFailure === null

  return (
    <>
      <div data-design="Head">
        <Header
          title="ウェビナー"
          description="動画セミナーの申込から視聴、視聴後のフォロー配信までを管理します。"
          action={
            <div className="flex flex-wrap gap-2">
              <button
                disabled
                title="マニュアルは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
              >
                マニュアル
              </button>
              <button
                disabled
                title="並び替えは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
              >
                並び替え
              </button>
              {/* ウェビナーにフォルダを持たせる列が無い。 */}
              <button
                disabled
                title="フォルダは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
              >
                フォルダを追加
              </button>
              <Link
                href="/webinars/new"
                className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium"
              >
                ウェビナーを作成
              </Link>
            </div>
          }
        />
      </div>

      {/*
        帯は `GET /api/webinars/overview` を読む。**数えられないものを
        0にしない**——口が `unavailable` と理由を返すので、`—` と理由を
        そのまま出す。設計の視聴312人・72.9%は固定値で置かない。
      */}
      {overviewFailure ? (
        <div className="mx-auto mb-4 max-w-6xl px-6">
          <ListState
            kind={overviewFailure.kind}
            title={overviewFailure.title}
            description={overviewFailure.description}
            action={
              overviewFailure.kind === 'error'
                ? <Button onClick={() => void refreshOverview()}>集計を読み直す</Button>
                : undefined
            }
          />
        </div>
      ) : (
        <div data-design="KPIs" className="mx-auto mb-4 grid max-w-6xl grid-cols-1 gap-4 px-6 sm:grid-cols-2 xl:grid-cols-4">
          {overviewCards(overview).map((card) => (
            <div key={card.key} className="bg-canvas rounded-card border-hairline border p-4">
              <p className="text-ink-faint text-xs">{card.title}</p>
              <p className={`mt-1 text-2xl font-bold tabular-nums ${card.view.available ? 'text-ink' : 'text-ink-faint'}`}>
                {card.view.text}
              </p>
              {/* 未取得のときは理由、読めているときだけ添え字。 */}
              <p className="text-ink-faint mt-0.5 text-xs">{card.view.note ?? card.detail ?? ''}</p>
            </div>
          ))}
        </div>
      )}
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
          <select
            disabled
            title="並び替えは準備中です"
            className="border-hairline rounded-control border px-2 py-2 text-sm opacity-50"
          >
            <option>申込が多い順</option>
          </select>
          <span className="text-ink-faint text-xs whitespace-nowrap">表示</span>
          <select
            disabled
            title="表示件数の切り替えは準備中です"
            className="border-hairline rounded-control border px-2 py-2 text-sm opacity-50"
          >
            <option>20件</option>
          </select>
        </div>

        <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-ink-faint text-xs whitespace-nowrap">保存した条件</span>
          {['よく使う', '公開中のみ', '下書きのみ'].map((label) => (
            <button
              key={label}
              disabled
              title="保存した条件は準備中です"
              className="border-hairline text-ink-faint rounded-pill border px-3 py-1 text-xs opacity-50"
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <ListState kind="loading" />
        ) : loadFailure ? (
          <ListState
            kind={loadFailure.kind}
            title={loadFailure.title}
            description={loadFailure.description}
            action={<Button onClick={() => void refresh()}>もう一度読み込む</Button>}
          />
        ) : shown.length === 0 ? (
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
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {shown.map((w) => (
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
      </div>
    </>
  )
}
