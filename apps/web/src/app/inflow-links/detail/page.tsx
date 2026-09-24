'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ApiError, api, fetchApi } from '@/lib/api'
import Button from '@/components/shared/button'
import EditRouteModal from '../_components/edit-route-modal'
import RefOrdersPanel, { type RefOrdersResult } from '../_components/ref-orders'
import Select from '@/components/shared/select'
import { TableHeadRow, Th } from '@/components/shared/table'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import type {
  EntryRoute,
  EntryRouteFunnel,
  Scenario,
  Tag,
  TrafficPool,
} from '@line-crm/shared'

/** 選んだ流入元の人数、成果、友だち、追加時の動きをまとめて表示する。 */

interface MessageTemplate {
  id: string
  name: string
  messageType: string
  messageContent: string
}

interface AttributedFriend {
  id: string
  displayName: string
  trackedAt: string | null
  // #514-8: 口が返すのは currentStatus(いまの状態)だけ。はじめて見た
  // ページ・成果・マイルの集計口は無いので、無い欄は「—」にする。
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
  // #514-12: 段階の取得失敗を読込中と混ぜない。失敗したら文と再読み込みを出す。
  const [funnelError, setFunnelError] = useState(false)
  const [funnelAttempt, setFunnelAttempt] = useState(0)
  const [friends, setFriends] = useState<AttributedFriend[]>([])
  // IDEA-18: 購入・返金のカード値は注文明細パネルが取った集計と同じ値を使う
  // （集計と明細が同じ条件であることを画面内で一致させる）。未取得は null。
  const [ordersSummary, setOrdersSummary] = useState<RefOrdersResult | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [pools, setPools] = useState<TrafficPool[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  // #514-13: 「この経路を編集」は編集窓を開く(押しても何も起きない状態を直す)。
  const [editingRoute, setEditingRoute] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteChoice, setDeleteChoice] = useState<'stop' | 'redirect' | 'delete'>('stop')
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('')
  const [canPermanentlyDelete, setCanPermanentlyDelete] = useState(false)
  // 「別の流入リンクへ送る」の転送先。先頭を自動採用しない（#514 重大4）。
  const [redirectTargetId, setRedirectTargetId] = useState('')
  const deleteDialogRef = useOverlayFocus(
    deleteOpen,
    () => setDeleteOpen(false),
    deleting,
  )
  const selectedId =
    id || routes.find((entryRoute) => entryRoute.refCode === requestedRefCode)?.id || ''

  // 左のリンク一覧。流入件数を添えるので、集計も一緒に引く。
  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([
      api.entryRoutes.list(),
      api.tags.list(),
      api.scenarios.list(),
      // プールは補助データ。機能がオフでもリンク詳細画面そのものは止めない。
      api.pools.list({ suppressFeatureDisabledEvent: true }),
      // 編集窓の「追加直後に送るメッセージ」選択肢に使う。
      api.templates.list(),
      api.staff.me(),
    ]).then(([r, t, sc, p, tp, me]) => {
      if (cancelled) return
      if (r.status === 'fulfilled' && r.value.success) setRoutes(r.value.data)
      if (t.status === 'fulfilled' && t.value.success) setTags(t.value.data)
      if (sc.status === 'fulfilled' && sc.value.success) setScenarios(sc.value.data)
      if (p.status === 'fulfilled' && p.value.success) setPools(p.value.data)
      if (tp.status === 'fulfilled' && tp.value.success) {
        setTemplates(tp.value.data as unknown as MessageTemplate[])
      }
      if (me.status === 'fulfilled' && me.value.success) {
        setCanPermanentlyDelete(me.value.data.role === 'owner' || me.value.data.role === 'admin')
      }
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
      setFunnelError(false)
      setFriends([])
      setOrdersSummary(null)
      return
    }
    let cancelled = false
    setError('')
    // #514-12: 段階の失敗を読込中のままにしない。再読み込みは funnelAttempt で引き直す。
    setFunnel(null)
    setFunnelError(false)
    setOrdersSummary(null)
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
      } else setError('リンクの取得に失敗しました。もう一度読み込んでください。')
      if (f.status === 'fulfilled' && f.value.success) setFunnel(f.value.data)
      else if (!cancelled) setFunnelError(true)
    })
    return () => {
      cancelled = true
    }
  }, [selectedId, funnelAttempt])

  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const url = route ? `${workerBase}/r/${encodeURIComponent(route.refCode)}` : null

  /** コピーできなかったとき、選んでコピーできる欄をその場に出す（ブラウザの入力窓は使わない。V6R-S3-f）。 */
  const [copyFailed, setCopyFailed] = useState(false)

  async function copyUrl() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setCopyFailed(false)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyFailed(true)
    }
  }

  async function applyDeleteChoice() {
    if (!route || deleting) return
    if (deleteChoice === 'delete' && !canPermanentlyDelete) {
      setDeleteChoice('stop')
      setDeleteError('完全削除には管理者権限が必要です。受付停止を選んでください。')
      return
    }
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
          redirectUrl: `${workerBase}/r/${encodeURIComponent(redirectTarget.refCode)}`,
        })
        if (!result.success) throw new Error(result.error)
      } else {
        const result = deleteChoice === 'delete'
          ? await fetchApi<{ success: boolean; error?: string }>(`/api/entry-routes/${encodeURIComponent(route.id)}`, {
              method: 'DELETE',
              body: JSON.stringify({ confirmationName: deleteConfirmationName }),
            })
          : await api.entryRoutes.update(route.id, { isActive: false })
        if (!result.success) throw new Error(result.error)
      }
      setDeleteOpen(false)
      router.replace('/inflow-links')
    } catch (cause) {
      setDeleteError(cause instanceof ApiError && (
        cause.code === 'ENTRY_ROUTE_IN_USE'
        || cause.code === 'ENTRY_ROUTE_NAME_CONFIRMATION_MISMATCH'
      )
        ? cause.message
        : '選んだ処理を完了できませんでした。状態を読み直してから、もう一度お試しください。')
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
      {/*
        U097: 「表示できませんでした」のあとに戻る操作が無かった。
        一覧へ戻るリンクを文のそばに置く。
      */}
      {!route ? (
        <div className="rounded-card border border-hairline bg-canvas p-12 text-center text-sm text-ink-faint">
          {loading ? '読み込み中…' : (
            <>
              <p>流入元を表示できませんでした。削除されたか、リンクが古くなっています。</p>
              <Link href="/inflow-links" className="text-action mt-3 inline-block font-semibold hover:underline">流入経路の一覧へ戻る</Link>
            </>
          )}
        </div>
      ) : <>
        <div data-design="Head" className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div><div className="flex items-center gap-2"><span className="rounded-pill bg-canvas-sunken px-2 py-1 text-xs font-semibold"># {route.refCode}</span><span className="rounded-pill bg-canvas-sunken px-2 py-1 text-xs font-semibold">{route.genre || '未分類'}</span></div><p className="mt-2 text-sm text-ink-faint">{route.createdAt.slice(5, 10).replace('-', '/')} に発行。{url} を通った人の記録です。</p></div>
          <div className="flex gap-2"><Button onClick={copyUrl}>{copied ? 'コピーしました' : 'URLをコピー'}</Button><Button variant="secondary" onClick={() => setEditingRoute(true)}>この経路を編集</Button><Button variant="secondary" aria-label={`${route.name}の${canPermanentlyDelete ? '削除' : '受付停止'}を確認`} onClick={() => { setDeleteError(''); setDeleteChoice('stop'); setDeleteConfirmationName(''); setRedirectTargetId(''); setDeleteOpen(true) }}>{canPermanentlyDelete ? 'この経路を削除' : '受付を止める'}</Button></div>
        </div>
        {copyFailed && url && (
          <div role="alert" className="mb-4 space-y-2 rounded-control border border-hairline bg-canvas-sunken p-3 text-sm text-ink-secondary">
            <p>コピーできませんでした。下の欄を選んでコピーしてください。</p>
            <input
              readOnly
              autoFocus
              value={url}
              aria-label="流入経路のURL"
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-control border border-hairline bg-canvas px-3 py-2 font-mono text-xs"
            />
          </div>
        )}
        {/*
          口から取れない数は書かない（#514 重大3）。funnel の4数は累計。
          残数・ブロック数・1人あたり金額の集計口は無いので「—」+理由表示。
        */}
        {/*
          IDEA-18: 購入・返金もこの経路へ連結して出す。数は下の注文明細と同じ口
          （/api/analytics/ref/:ref/orders）から取り、first-touch（その経路で
          最初に来た友だち）の注文だけを数える。友だちに結びついていない注文や
          経路の分からない注文は未計測としてここには出ない。
        */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"><MetricCard label="クリック" value={funnel?.click_count} unit="回" detail="累計" /><MetricCard label="友だちになった" value={funnel?.friend_add_count} unit="人" detail={`追加率 ${addRate ?? '—'}%`} /><MetricCard label="いま残っている" value={null} unit="人" detail="残数とブロック数の集計は未接続です" /><MetricCard label="成果" value={funnel?.cv_count} unit="件" detail="1人あたりの金額は未接続です" /><MetricCard label="購入" value={ordersSummary?.total ?? null} unit="件" detail={ordersSummary ? 'この経路から来た人の注文（累計）' : '注文の集計を取得できていません'} /><MetricCard label="返金・取消" value={ordersSummary ? ordersSummary.refunded + ordersSummary.cancelled : null} unit="件" detail={ordersSummary ? `返金 ${ordersSummary.refunded.toLocaleString('ja-JP')}・取消 ${ordersSummary.cancelled.toLocaleString('ja-JP')}` : '注文の集計を取得できていません'} /></div>
        {/*
          IDEA-18: 集計の期間・帰属ルール・計測できる範囲の断り書き。
          未計測を0と読ませないため、数えられないものを明記する。
        */}
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          期間は累計（全期間）です。購入・返金は、この経路のURLをはじめて通って追加された友だちに結びついた注文だけを数えます
          （はじめて来た経路にだけ付く帰属＝first-touch）。LINEの友だちと結びついていない注文、
          経路の分からない友だちの注文、URLを開くだけで友だち追加に進まなかったクリックは計測できず、この数には入りません。
          同じ注文は取り込み元ごとの注文番号で1件にまとまるため、再取込で二重に増えません。
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-4">
          <div data-design="Left" className="space-y-4 xl:col-span-3">
            <section><h2 className="text-lg font-bold text-ink">この経路から来た人の、その後</h2><p className="text-xs text-ink-faint">来ただけで終わっていないかを見ます。</p><div className="mt-3 rounded-card border border-hairline bg-canvas p-4">{funnel ? <FunnelView funnel={funnel} /> : funnelError ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-ink-secondary">段階を取得できませんでした。集計データは消えていません。</p><Button variant="secondary" onClick={() => setFunnelAttempt((n) => n + 1)}>段階を再読み込み</Button></div> : <p className="text-xs text-ink-faint">読み込み中…</p>}</div></section>
            <section><h2 className="text-lg font-bold text-ink">この経路から来た友だち</h2><p className="text-xs text-ink-faint">新しい順</p>{friends.length === 0 ? <p className="mt-3 text-xs text-ink-faint">この経路から来た友だちは、まだ記録されていません。</p> : <div className="mt-3 overflow-hidden rounded-card border border-hairline bg-canvas"><table className="w-full table-fixed text-xs"><thead className="border-b border-hairline bg-canvas-sunken text-ink-faint"><TableHeadRow><Th>友だち</Th><Th>いつ来たか</Th><Th>いまの状態</Th><Th>この人の成果</Th><Th>マイル</Th><Th align="right">確認</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">{friends.slice(0, 5).map((friend) => <tr key={friend.id}><td className="px-3 py-3 font-semibold text-ink"><span className="block">{friend.displayName}</span><span className="block truncate font-normal text-ink-faint">はじめて見たページ {friend.firstPage ?? '—'}</span></td><td className="px-3 py-3 text-ink-secondary">{friend.trackedAt ? friend.trackedAt.slice(5, 16).replace('T', ' ').replaceAll('-', '/') : '日時不明'}</td><td className="px-3 py-3 font-semibold text-ink-secondary">{friend.currentStatus ?? '—'}</td><td className="px-3 py-3 text-ink-secondary">{friend.conversion ?? '—'}</td><td className="px-3 py-3 font-semibold text-ink">{friend.miles ?? '—'}</td><td className="px-3 py-3 text-right"><Link href={`/friends/detail?id=${encodeURIComponent(friend.id)}`} className="text-action hover:underline">友だちを見る</Link></td></tr>)}</tbody></table></div>}</section>
            {/*
              IDEA-18: 経路別集計（上の購入カード）と同じ条件の注文明細。
              「購入 ○件」とこの一覧の全件数をそのままつき合わせられる。
            */}
            <section><h2 className="text-lg font-bold text-ink">この経路からの注文</h2><p className="text-xs text-ink-faint">上の「購入」の数と同じ条件の明細です。返金・取り消しは状態に出ます。</p><div className="mt-3 rounded-card border border-hairline bg-canvas p-4">{route ? <RefOrdersPanel refCode={route.refCode} onSummaryChange={setOrdersSummary} /> : null}</div></section>
          </div>
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
      {editingRoute && route && <EditRouteModal
        route={route}
        pools={pools}
        scenarios={scenarios}
        templates={templates}
        tags={tags}
        existingGenres={[...new Set(routes.map((entryRoute) => entryRoute.genre).filter((genre): genre is string => !!genre))]}
        onClose={() => setEditingRoute(false)}
        onSaved={(savedRoute) => {
          setRoutes((current) => current.map((entryRoute) => entryRoute.id === savedRoute.id ? savedRoute : entryRoute))
          setRoute(savedRoute)
          setEditingRoute(false)
        }}
      />}
      {deleteOpen && route && <div className="fixed inset-0 z-70 flex items-center justify-center bg-ink/35 p-4" data-design-node="UIaM7" role="dialog" aria-modal="true" aria-labelledby="inflow-delete-title">
        <div ref={deleteDialogRef} tabIndex={-1} className="w-full overflow-hidden rounded-card bg-canvas shadow-2xl" style={{ maxWidth: 840 }}>
          <div className="flex items-start gap-3 border-b border-hairline px-6 py-5" style={{ minHeight: 96 }}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-bg text-xl font-bold text-danger">!</span><div className="min-w-0 flex-1"><h2 id="inflow-delete-title" className="text-xl font-bold text-ink">「{route.name}」を削除しますか？</h2><p className="mt-1 text-sm text-ink-faint">このURLは {route.createdAt.slice(5, 10).replace('-', '/')} から使われています。消すと同じURLは開けなくなります。</p></div><button type="button" onClick={() => setDeleteOpen(false)} disabled={deleting} aria-label="閉じる" className="rounded-mini shrink-0 p-1 text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button></div>
          <div className="space-y-4 p-6">
            <section className="rounded-control border border-status-danger bg-danger-bg p-4 text-status-danger"><h3 className="text-sm font-bold">削除すると、次のことが起きます</h3><div className="mt-3 divide-y divide-danger/15"><div className="flex items-center justify-between gap-4 py-2"><div><p className="text-sm font-bold">貼り付けたURL・QRコード</p><p className="mt-0.5 text-xs">このURLを置いた投稿や広告から開けなくなります。</p></div><span className="rounded-pill bg-canvas px-3 py-1 text-xs font-bold">差し替えが必要</span></div><div className="flex items-center justify-between gap-4 py-2"><div><p className="text-sm font-bold">この経路から来た記録</p><p className="mt-0.5 text-xs">{funnel?.friend_add_count ?? 0}人の流入元と成果は過去の記録として残ります。</p></div><span className="rounded-pill bg-canvas px-3 py-1 text-xs font-bold">記録は残る</span></div><div className="flex items-center justify-between gap-4 py-2"><div><p className="text-sm font-bold">追加時の動き</p><p className="mt-0.5 text-xs">新しい友だちへのタグ付けとシナリオ開始が止まります。</p></div><span className="rounded-pill bg-canvas px-3 py-1 text-xs font-bold">受付を停止</span></div></div></section>
            <p className="rounded-control bg-success-bg px-4 py-3 text-xs font-semibold text-success">この経路から来た友だちと、付いたタグ・進んでいるシナリオは消えません。</p>
            <div><h3 className="text-sm font-bold text-ink">どうしますか？</h3><div className="mt-2 grid gap-2">{([['stop','新しい人を受けるのをやめる（おすすめ）','URLは残し、「受付を終了しました」と表示します。','休'],['redirect','別の流入リンクへ送るようにする','印刷ずみのQRコードを別の経路へつなぎます。','→'],['delete','このまま削除する','利用履歴がない経路だけ完全に削除できます。元には戻せません。','×']] as const).filter(([value]) => value !== 'delete' || canPermanentlyDelete).map(([value,title,description,icon]) => <button key={value} type="button" disabled={deleting} onClick={() => setDeleteChoice(value)} className={`flex w-full items-center gap-3 rounded-control border p-3 text-left ${deleteChoice === value ? 'border-accent bg-accent-soft' : 'border-hairline bg-canvas'}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${deleteChoice === value ? 'border-accent-deep bg-accent-deep text-on-accent' : 'border-hairline text-ink-faint'}`}>{icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{title}</span><span className="mt-0.5 block text-xs text-ink-faint">{description}</span></span><span className="text-ink-faint">›</span></button>)}</div></div>
            {deleteChoice === 'redirect' && <div><p className="text-sm font-bold text-ink">転送先のリンク</p><Select aria-label="転送先のリンク" id="inflow-redirect-target" value={redirectTargetId} disabled={deleting} onChange={setRedirectTargetId} size="full" options={[{ value: '', label: '選んでください' }, ...routes.filter((candidate) => candidate.id !== route.id).map((candidate) => ({ value: candidate.id, label: `${candidate.name}（#${candidate.refCode}）` }))]} /><p className="text-ink-faint mt-1 text-xs">先頭を自動で選ぶことはしません。必ず選んでください。</p></div>}
            {deleteChoice === 'delete' && <div className="rounded-control border border-status-danger bg-danger-bg p-4"><label htmlFor="inflow-delete-confirmation" className="text-sm font-bold text-status-danger">完全削除するには「{route.name}」と入力</label><input id="inflow-delete-confirmation" value={deleteConfirmationName} disabled={deleting} onChange={(event) => setDeleteConfirmationName(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink" /><p className="mt-1 text-xs text-status-danger">空白や大文字・小文字も含め、現在の経路名と同じ入力が必要です。</p></div>}
            {deleteError && <p className="rounded-control bg-danger-bg px-4 py-3 text-sm text-status-danger">{deleteError}</p>}
          </div>
          <div className="flex items-center justify-between border-t border-hairline px-6 py-4" style={{ minHeight: 82 }}><p className="max-w-md text-xs text-ink-faint">選んだ方法を確認してから進みます。過去の友だち・タグ・分析記録は消えません。</p><div className="flex gap-2"><Button variant="secondary" disabled={deleting} onClick={() => setDeleteOpen(false)}>キャンセル</Button><Button onClick={() => void applyDeleteChoice()} disabled={deleting || (deleteChoice === 'delete' && deleteConfirmationName !== route.name)}>{deleteChoice === 'stop' ? '受けるのをやめる' : deleteChoice === 'redirect' ? '別のリンクへ送る' : 'この経路を削除'}</Button></div></div>
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
