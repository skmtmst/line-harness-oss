'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { api, fetchApi } from '@/lib/api'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { TableHeadRow, Th } from '@/components/shared/table'
import type {
  EntryRoute,
  EntryRouteFunnel,
  Scenario,
  Tag,
  TrafficPool,
} from '@line-crm/shared'

/** 選んだ流入元の人数、成果、友だち、追加時の動きをまとめて表示する。 */

interface AttributedFriend {
  id: string
  displayName: string
  trackedAt: string | null
  firstPage?: string
  currentStatus?: string
  conversion?: string
  miles?: number
}

function InflowLinkDetailPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const requestedRefCode = searchParams.get('ref') ?? ''

  const [routes, setRoutes] = useState<EntryRoute[]>([])
  const [route, setRoute] = useState<EntryRoute | null>(null)
  const [funnel, setFunnel] = useState<EntryRouteFunnel | null>(null)
  const [friends, setFriends] = useState<AttributedFriend[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [pools, setPools] = useState<TrafficPool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteChoice, setDeleteChoice] = useState<'stop' | 'redirect' | 'delete'>('stop')
  // 「別の流入リンクへ送る」の転送先。先頭を自動採用しない（#514 重大4）。
  const [redirectTargetId, setRedirectTargetId] = useState('')
  const selectedId =
    id || routes.find((entryRoute) => entryRoute.refCode === requestedRefCode)?.id || ''

  // 左のリンク一覧。流入件数を添えるので、集計も一緒に引く。
  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([
      api.entryRoutes.list(),
      api.tags.list(),
      api.scenarios.list(),
      api.pools.list(),
    ]).then(([r, t, sc, p]) => {
      if (cancelled) return
      if (r.status === 'fulfilled' && r.value.success) setRoutes(r.value.data)
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
    if (!selectedId) {
      setRoute(null)
      setFunnel(null)
      setFriends([])
      return
    }
    let cancelled = false
    setError('')
    void Promise.allSettled([
      api.entryRoutes.get(selectedId),
      api.entryRoutes.funnel(selectedId),
    ]).then(async ([r, f]) => {
      if (cancelled) return
      if (r.status === 'fulfilled' && r.value.success) {
        setRoute(r.value.data)
        try {
          const result = await fetchApi<{
            success: boolean
            data: { friends: AttributedFriend[] }
          }>(`/api/analytics/ref/${encodeURIComponent(r.value.data.refCode)}`)
          if (!cancelled && result.success && Array.isArray(result.data?.friends)) {
            setFriends(result.data.friends)
          }
        } catch {
          if (!cancelled) setFriends([])
        }
      } else setError('リンクの取得に失敗しました')
      if (f.status === 'fulfilled' && f.value.success) setFunnel(f.value.data)
    })
    return () => {
      cancelled = true
    }
  }, [selectedId])

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

  async function applyDeleteChoice() {
    if (!route || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      if (deleteChoice === 'redirect') {
        // 転送先は必ず利用者に選ばせる。選ばずに進ませない。
        const redirectTarget = routes.find((candidate) => candidate.id === redirectTargetId && candidate.id !== route.id)
        if (!redirectTarget) {
          setDeleteError('転送先のリンクを選んでください')
          return
        }
        const result = await api.entryRoutes.update(route.id, {
          redirectUrl: `${workerBase}/r/${redirectTarget.refCode}`,
        })
        if (!result.success) throw new Error(result.error)
      } else {
        const result = deleteChoice === 'delete'
          ? await api.entryRoutes.delete(route.id)
          : await api.entryRoutes.update(route.id, { isActive: false })
        if (!result.success) throw new Error(result.error)
      }
      setDeleteOpen(false)
      router.replace('/inflow-links')
    } catch {
      setDeleteError(
        '選んだ処理を完了できませんでした。状態を読み直してから、もう一度お試しください。',
      )
    } finally {
      setDeleting(false)
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

  return (
    <div data-design-node="JupxW" data-design="Body">
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/inflow-links" className="hover:underline">
          流入経路
        </Link>
        <span className="mx-1.5">/</span>
        <span>リンクの詳細</span>
      </nav>

      {error && <p className="text-danger mb-3 text-sm">{error}</p>}
      {!route ? <div className="rounded-card border border-hairline bg-canvas p-12 text-center text-sm text-ink-faint">{loading ? '読み込み中…' : '流入元を表示できませんでした。'}</div> : <>
        <div data-design="Head" className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div><div className="flex items-center gap-2"><span className="rounded-pill bg-canvas-sunken px-2 py-1 text-xs font-semibold"># {route.refCode}</span><span className="rounded-pill bg-canvas-sunken px-2 py-1 text-xs font-semibold">{route.genre || '未分類'}</span></div><p className="mt-2 text-sm text-ink-faint">{route.createdAt.slice(5, 10).replace('-', '/')} に発行。{url} を通った人の記録です。</p></div>
          <div className="flex gap-2"><Button onClick={copyUrl}>{copied ? 'コピーしました' : 'URLをコピー'}</Button><Button variant="secondary">この経路を編集</Button><Button variant="secondary" aria-label={`${route.name}の削除を確認`} onClick={() => { setDeleteError(''); setDeleteChoice('stop'); setRedirectTargetId(''); setDeleteOpen(true) }}>この経路を削除</Button></div>
        </div>
        {/*
          口から取れない数は書かない（#514 重大3）。funnel の4数は累計。
          残数・ブロック数・1人あたり金額の集計口は無いので「—」+理由表示。
        */}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4"><MetricCard label="クリック" value={funnel?.click_count} unit="回" detail="累計" /><MetricCard label="友だちになった" value={funnel?.friend_add_count} unit="人" detail={`追加率 ${addRate ?? '—'}%`} /><MetricCard label="いま残っている" value={null} unit="人" detail="残数とブロック数の集計は未接続です" /><MetricCard label="成果" value={funnel?.cv_count} unit="件" detail="1人あたりの金額は未接続です" /></div>
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-4">
          <main data-design="Left" className="space-y-4 xl:col-span-3">
            <section><h2 className="text-lg font-bold text-ink">この経路から来た人の、その後</h2><p className="text-xs text-ink-faint">来ただけで終わっていないかを見ます。</p><div className="mt-3 rounded-card border border-hairline bg-canvas p-4">{funnel ? <FunnelView funnel={funnel} /> : <p className="text-xs text-ink-faint">読み込み中…</p>}</div></section>
            <section><h2 className="text-lg font-bold text-ink">この経路から来た友だち</h2><p className="text-xs text-ink-faint">新しい順</p>{friends.length === 0 ? <p className="mt-3 text-xs text-ink-faint">この経路から来た友だちは、まだ記録されていません。</p> : <div className="mt-3 overflow-hidden rounded-card border border-hairline bg-canvas"><table className="w-full table-fixed text-xs"><thead className="border-b border-hairline bg-canvas-sunken text-ink-faint"><TableHeadRow><Th>友だち</Th><Th>いつ来たか</Th><Th>いまの状態</Th><Th>この人の成果</Th><Th>マイル</Th><Th align="right">確認</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">{friends.slice(0, 5).map((friend) => <tr key={friend.id}><td className="px-3 py-3 font-semibold text-ink"><span className="block">{friend.displayName}</span><span className="block truncate font-normal text-ink-faint">はじめて見たページ {friend.firstPage ?? '—'}</span></td><td className="px-3 py-3 text-ink-secondary">{friend.trackedAt ? friend.trackedAt.slice(5, 16).replace('T', ' ').replaceAll('-', '/') : '日時不明'}</td><td className="px-3 py-3 font-semibold text-ink-secondary">{friend.currentStatus ?? '取得できません'}</td><td className="px-3 py-3 text-ink-secondary">{friend.conversion ?? '取得できません'}</td><td className="px-3 py-3 font-semibold text-ink">{friend.miles ?? '—'}</td><td className="px-3 py-3 text-right"><Link href={`/friends/detail?id=${encodeURIComponent(friend.id)}`} className="text-action hover:underline">友だちを見る</Link></td></tr>)}</tbody></table></div>}</section>
          </main>
          <aside data-design="Right" className="space-y-4">
            {/*
              「マイルを 100 付ける」は設計（Pencil ★V6・design-structure.json）に
              ある文言のため残す。口から取れない定数ではあるが、設計をコード
              だけで消さない（#514 重大3のうち本行は司令塔へ判断依頼 #531）。
            */}
            <section className="rounded-card border border-hairline bg-canvas p-5"><h2 className="text-sm font-bold text-ink">この経路にしていること</h2><ul className="mt-3 space-y-3 text-xs text-ink-secondary"><li>{route.scenarioId ? `シナリオ「${scenarioName ?? '取得できません'}」を始める` : 'シナリオは始めない'}</li><li>{route.tagId ? `タグ「${tagName ?? '取得できません'}」を付ける` : 'タグは付けない'}</li><li>マイルを 100 付ける</li></ul></section>
            <section className="rounded-card border border-status-warn bg-status-warn-soft p-5"><h2 className="text-sm font-bold text-status-warn-deep">気づいたこと</h2><p className="mt-3 text-xs text-status-warn-deep">反応・ブロックの集計は未接続のため表示できません</p></section>
            <section className="rounded-card border border-hairline bg-canvas p-5"><h2 className="text-sm font-bold text-ink">つながる先</h2><ul className="mt-3 space-y-2 text-xs text-action"><li>→ シナリオ配信</li><li>→ 友だち</li><li>→ 成果とアフィリエイト</li><li>→ コンバージョン</li><li>→ 分析</li></ul></section>
          </aside>
        </div>
      </>}
      {deleteOpen && route && <div className="fixed inset-0 z-70 flex items-center justify-center bg-ink/35 p-4" data-design-node="UIaM7" role="dialog" aria-modal="true">
        <div className="w-full overflow-hidden rounded-card bg-canvas shadow-2xl" style={{ maxWidth: 840 }}>
          <div className="flex items-start gap-3 border-b border-hairline px-6 py-5" style={{ minHeight: 96 }}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-bg text-xl font-bold text-danger">!</span><div><h2 className="text-xl font-bold text-ink">「{route.name}」を削除しますか？</h2><p className="mt-1 text-sm text-ink-faint">このURLは {route.createdAt.slice(5, 10).replace('-', '/')} から使われています。消すと同じURLは開けなくなります。</p></div></div>
          <div className="space-y-4 p-6">
            <section className="rounded-control border border-status-danger bg-danger-bg p-4 text-status-danger"><h3 className="text-sm font-bold">削除すると、次のことが起きます</h3><div className="mt-3 divide-y divide-danger/15"><div className="flex items-center justify-between gap-4 py-2"><div><p className="text-sm font-bold">貼り付けたURL・QRコード</p><p className="mt-0.5 text-xs">このURLを置いた投稿や広告から開けなくなります。</p></div><span className="rounded-pill bg-canvas px-3 py-1 text-xs font-bold">差し替えが必要</span></div><div className="flex items-center justify-between gap-4 py-2"><div><p className="text-sm font-bold">この経路から来た記録</p><p className="mt-0.5 text-xs">{funnel?.friend_add_count ?? 0}人の流入元と成果は過去の記録として残ります。</p></div><span className="rounded-pill bg-canvas px-3 py-1 text-xs font-bold">記録は残る</span></div><div className="flex items-center justify-between gap-4 py-2"><div><p className="text-sm font-bold">追加時の動き</p><p className="mt-0.5 text-xs">新しい友だちへのタグ付けとシナリオ開始が止まります。</p></div><span className="rounded-pill bg-canvas px-3 py-1 text-xs font-bold">受付を停止</span></div></div></section>
            <p className="rounded-control bg-success-bg px-4 py-3 text-xs font-semibold text-success">この経路から来た友だちと、付いたタグ・進んでいるシナリオは消えません。</p>
            <div><h3 className="text-sm font-bold text-ink">どうしますか？</h3><div className="mt-2 grid gap-2">{([['stop','新しい人を受けるのをやめる（おすすめ）','URLは残し、「受付を終了しました」と表示します。','休'],['redirect','別の流入リンクへ送るようにする','印刷ずみのQRコードを別の経路へつなぎます。','→'],['delete','このまま削除する','URLが開けなくなり、元には戻せません。','×']] as const).map(([value,title,description,icon]) => <button key={value} type="button" onClick={() => setDeleteChoice(value)} className={`flex w-full items-center gap-3 rounded-control border p-3 text-left ${deleteChoice === value ? 'border-accent bg-accent-soft' : 'border-hairline bg-canvas'}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${deleteChoice === value ? 'border-accent bg-accent text-on-accent' : 'border-hairline text-ink-faint'}`}>{icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{title}</span><span className="mt-0.5 block text-xs text-ink-faint">{description}</span></span><span className="text-ink-faint">›</span></button>)}</div></div>
            {deleteChoice === 'redirect' && <div><p className="text-sm font-bold text-ink">転送先のリンク</p><Select aria-label="転送先のリンク" id="inflow-redirect-target" value={redirectTargetId} onChange={setRedirectTargetId} size="full" options={[{ value: '', label: '選んでください' }, ...routes.filter((candidate) => candidate.id !== route.id).map((candidate) => ({ value: candidate.id, label: `${candidate.name}（#${candidate.refCode}）` }))]} /><p className="text-ink-faint mt-1 text-xs">先頭を自動で選ぶことはしません。必ず選んでください。</p></div>}
            {deleteError && <p className="rounded-control bg-danger-bg px-4 py-3 text-sm text-status-danger">{deleteError}</p>}
          </div>
          <div className="flex items-center justify-between border-t border-hairline px-6 py-4" style={{ minHeight: 82 }}><p className="max-w-md text-xs text-ink-faint">選んだ方法を確認してから進みます。過去の友だち・タグ・分析記録は消えません。</p><div className="flex gap-2"><Button variant="secondary" onClick={() => { if (!deleting) setDeleteOpen(false) }}>キャンセル</Button><Button onClick={() => void applyDeleteChoice()} disabled={deleting}>{deleteChoice === 'stop' ? '受けるのをやめる' : deleteChoice === 'redirect' ? '別のリンクへ送る' : 'この経路を削除'}</Button></div></div>
        </div>
      </div>}
    </div>
  )
}

function MetricCard({ label, value, unit, detail }: { label: string; value: number | null | undefined; unit: string; detail: string }) {
  return (
    <div className="rounded-card border border-hairline bg-canvas p-4">
      <dt className="text-ink-faint text-xs">{label}</dt>
      <dd className="text-ink text-xl font-bold tabular-nums">
        {value == null ? '—' : value.toLocaleString()}
        <span className="text-ink-faint ml-0.5 text-xs font-normal">{unit}</span>
      </dd>
      <p className="mt-1 text-xs text-ink-faint">{detail}</p>
    </div>
  )
}

function FunnelView({ funnel }: { funnel: EntryRouteFunnel }) {
  const stages = [
    { label: 'クリックした', value: funnel.click_count, prev: null as number | null },
    { label: '友だち追加', value: funnel.friend_add_count, prev: funnel.click_count },
    // 「いま残っている」の集計口は無い。定数を書かず「—」にする（#514 重大3）。
    { label: 'いま残っている', value: null as number | null, prev: funnel.friend_add_count },
    { label: '返事をした・押した', value: funnel.form_submission_count, prev: null as number | null },
    { label: '成果になった', value: funnel.cv_count, prev: funnel.form_submission_count },
  ]

  return (
    <ol className="grid grid-cols-1 gap-2 md:grid-cols-5">
      {stages.map((s) => {
        // ひとつ前が0のときは割合を出さない。0で割ると Infinity になるし、
        // 「0人のうち何%」は意味を持たない。
        const pct = typeof s.value === 'number' && typeof s.prev === 'number' && s.prev > 0
          ? ((s.value / s.prev) * 100).toFixed(1)
          : null
        return (
          <li key={s.label} className="relative rounded-control bg-canvas-sunken px-3 py-3">
            <div>
              <span className="block text-xs text-ink-secondary">{s.label}</span>
              <span className="mt-1 block text-xl font-bold tabular-nums text-ink">
                {/*
                  **取れていない段は `—`。** 0 と書くと「その段まで誰も
                  進まなかった」に読める。取れていないだけなら、
                  施策を止める判断を誤る。
                */}
                {typeof s.value === 'number' ? s.value.toLocaleString() : '—'}
                {typeof s.value === 'number' && pct !== null && (
                  <span className="ml-1.5 text-xs font-normal text-ink-faint">{pct}%</span>
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
