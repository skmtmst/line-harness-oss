'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { api, fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import type {
  EntryRoute,
  EntryRouteFunnel,
  Scenario,
  Tag,
  TrafficPool,
} from '@line-crm/shared'

/**
 * 流入経路の詳細（設計 V2 6-2-1）。
 *
 * 左でリンクを選び、右にその内訳を出す。設計が一覧と別画面にしているのは、
 * 「どこから友だちになって、どこまで進んだか」を1本ずつ追う画面だから。
 * 一覧の表に列を足していくと、どの数字がどの段階のものか読めなくなる。
 */

interface RefRouteStats {
  refCode: string
  name: string | null
  friendCount: number
  clickCount: number
  latestAt: string | null
}

interface SourceRow {
  label: string
  count: number
}

function InflowLinkDetailPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''

  const [routes, setRoutes] = useState<EntryRoute[]>([])
  const [stats, setStats] = useState<Map<string, RefRouteStats>>(new Map())
  const [route, setRoute] = useState<EntryRoute | null>(null)
  const [funnel, setFunnel] = useState<EntryRouteFunnel | null>(null)
  const [sources, setSources] = useState<SourceRow[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [pools, setPools] = useState<TrafficPool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  // 左のリンク一覧。流入件数を添えるので、集計も一緒に引く。
  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([
      api.entryRoutes.list(),
      fetchApi<{ success: boolean; data: { routes: RefRouteStats[] } }>(
        '/api/analytics/ref-summary',
      ),
      api.tags.list(),
      api.scenarios.list(),
      api.pools.list(),
    ]).then(([r, sum, t, sc, p]) => {
      if (cancelled) return
      if (r.status === 'fulfilled' && r.value.success) setRoutes(r.value.data)
      if (sum.status === 'fulfilled' && sum.value.success) {
        setStats(new Map(sum.value.data.routes.map((x) => [x.refCode, x])))
      }
      if (t.status === 'fulfilled' && t.value.success) setTags(t.value.data)
      if (sc.status === 'fulfilled' && sc.value.success) setScenarios(sc.value.data)
      if (p.status === 'fulfilled' && p.value.success) setPools(p.value.data)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 右の内訳。リンクを選び直すたびに引き直す。
  useEffect(() => {
    if (!id) {
      setRoute(null)
      setFunnel(null)
      setSources([])
      return
    }
    let cancelled = false
    setError('')
    void Promise.allSettled([
      api.entryRoutes.get(id),
      api.entryRoutes.funnel(id),
      api.entryRoutes.sources(id),
    ]).then(([r, f, s]) => {
      if (cancelled) return
      if (r.status === 'fulfilled' && r.value.success) setRoute(r.value.data)
      else setError('リンクの取得に失敗しました')
      if (f.status === 'fulfilled' && f.value.success) setFunnel(f.value.data)
      if (s.status === 'fulfilled' && s.value.success) setSources(s.value.data)
    })
    return () => {
      cancelled = true
    }
  }, [id])

  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const url = route ? `${workerBase}/r/${route.refCode}` : null

  async function copyUrl() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('コピーしてください:', url)
    }
  }

  const tagName = route?.tagId ? (tags.find((t) => t.id === route.tagId)?.name ?? null) : null
  const scenarioName = route?.scenarioId
    ? (scenarios.find((s) => s.id === route.scenarioId)?.name ?? null)
    : null
  const poolName = route?.poolId ? (pools.find((p) => p.id === route.poolId)?.name ?? null) : null

  const addRate = useMemo(() => {
    if (!funnel || funnel.click_count === 0) return null
    return Math.round((funnel.friend_add_count / funnel.click_count) * 1000) / 10
  }, [funnel])

  const totalSources = sources.reduce((sum, s) => sum + s.count, 0)

  return (
    <div>
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/inflow-links" className="hover:underline">
          流入経路
        </Link>
        <span className="mx-1.5">/</span>
        <span>リンクの詳細</span>
      </nav>

      <div data-design="Head">
        <Header
          title="リンクの詳細"
          description="選んだリンクの流入とクリックの内訳を表示します。どこから友だちになって、どこまで進んだかを追えます。"
          action={
            <div className="flex flex-wrap gap-2">
              <button
                onClick={copyUrl}
                disabled={!url}
                className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                {copied ? 'コピーしました' : 'URLをコピー'}
              </button>
              <button
                disabled
                title="QRコードの保存は準備中です"
                className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
              >
                QRコードを保存
              </button>
            </div>
          }
        />
      </div>

      {error && <p className="text-danger mb-3 text-sm">{error}</p>}

      <div data-design="Body" className="flex flex-col gap-4 xl:flex-row">
        <div
          data-design="Left"
          className="bg-canvas rounded-card border-hairline w-full shrink-0 border p-4 xl:w-72"
        >
          <h2 className="text-ink text-sm font-semibold">リンクを選ぶ</h2>
          <p className="text-ink-faint mt-0.5 mb-3 text-xs">
            選んだリンクの内訳を右に表示します。
          </p>

          {loading ? (
            <p className="text-ink-faint text-xs">読み込み中…</p>
          ) : routes.length === 0 ? (
            <p className="text-ink-faint text-xs">
              まだリンクがありません。一覧の「URLを発行」から作ってください。
            </p>
          ) : (
            <ul className="space-y-1">
              {routes.map((r) => {
                const active = r.id === id
                const count = stats.get(r.refCode)?.friendCount ?? 0
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => router.replace(`/inflow-links/detail?id=${r.id}`)}
                      className={`rounded-control w-full px-3 py-2 text-left transition-colors ${
                        active ? 'bg-accent-soft' : 'hover:bg-canvas-sunken'
                      }`}
                    >
                      <span className="text-ink block text-sm">{r.name}</span>
                      <span className="text-ink-faint block text-xs">
                        {r.genre || '未分類'} ・ {count}件の流入
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div data-design="Right" className="min-w-0 flex-1 space-y-4">
          {!route ? (
            <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
              左からリンクを選んでください。
            </div>
          ) : (
            <>
              <section className="bg-canvas rounded-card border-hairline border p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-ink text-base font-semibold">{route.name}</h2>
                    <p className="text-ink-faint mt-0.5 text-xs">
                      {route.genre || '未分類'}
                    </p>
                    <p className="text-ink-faint mt-1 truncate text-xs">
                      {url} ・ 作成 {route.createdAt.slice(0, 10).replace(/-/g, '/')}
                    </p>
                  </div>
                  <span
                    className={`rounded-pill px-2 py-0.5 text-xs ${
                      route.isActive
                        ? 'bg-success-bg text-success'
                        : 'bg-canvas-sunken text-ink-faint'
                    }`}
                  >
                    {route.isActive ? '計測中' : '停止中'}
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="クリック" value={funnel?.click_count ?? null} unit="回" />
                  <Stat label="友だち追加" value={funnel?.friend_add_count ?? null} unit="人" />
                  <Stat label="追加率" value={addRate} unit="%" />
                  <Stat label="成果（CV）" value={funnel?.cv_count ?? null} unit="件" />
                </dl>
              </section>

              <section className="bg-canvas rounded-card border-hairline border p-5">
                <h3 className="text-ink text-sm font-semibold">リンクを踏んでから成果までの流れ</h3>
                <p className="text-ink-faint mt-0.5 mb-3 text-xs">
                  各段階の数と、ひとつ前の段階からの割合です。
                </p>
                {funnel ? (
                  <FunnelView funnel={funnel} />
                ) : (
                  <p className="text-ink-faint text-xs">読み込み中…</p>
                )}
              </section>

              <section className="bg-canvas rounded-card border-hairline border p-5">
                <h3 className="text-ink text-sm font-semibold">どこから来ているか</h3>
                <p className="text-ink-faint mt-0.5 mb-3 text-xs">
                  参照元と広告パラメータの内訳です。
                </p>
                {sources.length === 0 ? (
                  <p className="text-ink-faint text-xs">
                    まだクリックの記録がありません。
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {sources.map((s) => {
                      const pct = totalSources > 0 ? (s.count / totalSources) * 100 : 0
                      return (
                        <li key={s.label}>
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-ink truncate">{s.label}</span>
                            <span className="text-ink-faint shrink-0 tabular-nums">
                              {s.count} 回 ・ {Math.round(pct)}%
                            </span>
                          </div>
                          <div className="bg-canvas-sunken mt-1 h-1.5 overflow-hidden rounded-full">
                            <div className="bg-accent h-full" style={{ width: `${pct}%` }} />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              <section className="bg-canvas rounded-card border-hairline border p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-ink text-sm font-semibold">追加時の動作</h3>
                  <Link
                    href="/inflow-links"
                    className="text-accent shrink-0 text-xs hover:underline"
                  >
                    設定を編集
                  </Link>
                </div>
                <dl className="mt-3 space-y-2 text-xs">
                  <Row label="フォルダ" value={route.genre || '未分類'} />
                  <Row label="refコード" value={route.refCode} mono />
                  <Row label="自動で付けるタグ" value={tagName ?? '（なし）'} />
                  <Row label="開始するシナリオ" value={scenarioName ?? '（なし）'} />
                  <Row
                    label="追加先アカウント"
                    value={poolName ?? 'メインプールで自動振り分け'}
                  />
                </dl>
              </section>

              <section className="bg-canvas rounded-card border-hairline border p-5">
                <h3 className="text-ink text-sm font-semibold">気をつけること</h3>
                <ul className="text-ink-faint mt-2 space-y-1.5 text-xs leading-relaxed">
                  <li>・同じ人が何度クリックしても、友だち追加は1回として数えます</li>
                  <li>
                    ・フォーム回答と成果は、そのリンク経由で友だちになった人の分だけを集計します
                  </li>
                  <li>・経路が分からない友だちは「ref不明」に入ります</li>
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div>
      <dt className="text-ink-faint text-xs">{label}</dt>
      <dd className="text-ink text-xl font-bold tabular-nums">
        {value == null ? '—' : value.toLocaleString()}
        <span className="text-ink-faint ml-0.5 text-xs font-normal">{unit}</span>
      </dd>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-ink-faint shrink-0">{label}</dt>
      <dd className={`text-ink min-w-0 truncate text-right ${mono ? 'font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

function FunnelView({ funnel }: { funnel: EntryRouteFunnel }) {
  const stages = [
    { label: 'リンクのクリック', value: funnel.click_count, prev: null as number | null },
    { label: '友だち追加', value: funnel.friend_add_count, prev: funnel.click_count },
    {
      label: 'フォームの回答',
      value: funnel.form_submission_count,
      prev: funnel.friend_add_count,
    },
    { label: '成果（CV）', value: funnel.cv_count, prev: funnel.form_submission_count },
  ]

  return (
    <ol className="space-y-2">
      {stages.map((s) => {
        // ひとつ前が0のときは割合を出さない。0で割ると Infinity になるし、
        // 「0人のうち何%」は意味を持たない。
        const pct = s.prev !== null && s.prev > 0 ? ((s.value / s.prev) * 100).toFixed(1) : null
        return (
          <li key={s.label} className="border-hairline rounded-control border px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-secondary text-xs">{s.label}</span>
              <span className="text-ink text-sm font-semibold tabular-nums">
                {s.value.toLocaleString()}
                {pct !== null && (
                  <span className="text-ink-faint ml-1.5 text-xs font-normal">{pct}%</span>
                )}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
export default function InflowLinkDetailPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <InflowLinkDetailPageContent />
    </Suspense>
  )
}
