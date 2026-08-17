'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { webinarApi, type Webinar } from '@/lib/api'

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

export default function WebinarsPage() {
  const [items, setItems] = useState<Webinar[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await webinarApi.list()
      setItems(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // タイトルと slug の両方を見る。URLで探すこともあるため。
  const q = query.trim()
  const shown = q ? items.filter((w) => w.title.includes(q) || w.slug.includes(q)) : items

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

      <div data-design="KPIs" className="mx-auto mb-4 grid max-w-6xl grid-cols-1 gap-4 px-6 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">ウェビナー</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {items.length}
            <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            公開中 {items.filter((w) => w.status === 'active').length}
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

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-gray-500">
            読み込み中...
          </div>
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
