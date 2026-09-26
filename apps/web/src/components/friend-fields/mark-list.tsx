'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { LockKeyhole, Trash2, X } from 'lucide-react'
import ReorderGrip from './reorder-grip'
import { mergeVisibleOrder, movableIds } from './reorder-utils'
import { api, ApiError, type SupportMarkArchiveImpact, type SupportMarkListItem } from '@/lib/api'
import { createResponseGate } from '@/lib/latest-request'
import Button from '@/components/shared/button'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import ListKpis from '@/components/shared/list-kpis'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Notice from '@/components/shared/notice'
import { Th } from '@/components/shared/table'

type MarkRow = SupportMarkListItem
type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

function autoRuleLabel(mark: MarkRow): string {
  if (mark.automationRules.length > 0) return mark.automationRules.map((rule) => rule.name).join('・')
  return mark.autoOnInbound ? '受信時' : '—'
}

const DISPLAY_TARGET_LABELS: Record<NonNullable<MarkRow['displayTargets']>[number], string> = {
  inbox: '受信箱', friend_list: '友だち一覧', friend_detail: '友だち詳細', dashboard: 'ダッシュボード', broadcast: '一斉配信', automation: 'オートメーション',
}

/**
 * どこから呼ばれているか（設計 `rIhbN` の右から2列目）。
 *
 * **友だちの人数はここに混ぜない。** 隣の「使用中」列と同じ数がもう一度出て、
 * しかも `友だち8` と単位が落ちるため、8人なのか8件なのか読めなかった。
 * この列は配信・シナリオなど**設定側からの参照だけ**を数える。
 *
 * `usedIn` が無いのは「参照0」ではなく**まだ取れていない**状態。0件と
 * 言い切ると、消してよいマークだと読めてしまうので `—` を出す。
 */
function usageLabel(mark: MarkRow): string {
  const display = mark.displayTargets?.map((target) => DISPLAY_TARGET_LABELS[target]) ?? []
  const usedIn = mark.usedIn
  const parts: string[] = []
  if (usedIn?.broadcasts) parts.push(`配信${usedIn.broadcasts}件`)
  if (usedIn?.scenarios) parts.push(`シナリオ${usedIn.scenarios}件`)
  if (usedIn?.autoReplies) parts.push(`自動応答${usedIn.autoReplies}件`)
  if (usedIn?.savedSearches) parts.push(`保存検索${usedIn.savedSearches}件`)
  if (usedIn?.automations) parts.push(`自動化${usedIn.automations}件`)
  return [...display, ...parts].length ? [...display, ...parts].join('・') : mark.usedIn === undefined ? '—' : 'なし'
}

function referenceCount(mark: MarkRow): number {
  return (mark.usedIn?.broadcasts ?? 0)
    + (mark.usedIn?.scenarios ?? 0)
    + (mark.usedIn?.autoReplies ?? 0)
    + (mark.usedIn?.savedSearches ?? 0)
    + (mark.usedIn?.automations ?? 0)
}

function isUsed(mark: MarkRow): boolean {
  return mark.friendCount > 0 || referenceCount(mark) > 0
}

function ArchiveMarkDialog({ mark, impact, replacementMarkId, loading, saving, error, onReplacement, onCancel, onConfirm }: {
  mark: MarkRow
  impact: SupportMarkArchiveImpact | null
  replacementMarkId: string
  loading: boolean
  saving: boolean
  error: string
  onReplacement: (id: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useOverlayFocus(true, onCancel, saving)
  const selected = impact?.replacementOptions.find((option) => option.id === replacementMarkId)
  /*
    ATTR-17: 以前は画面上端から margin-top:310px に固定しており、
    390×600 のような縦の短い画面ではボタンが画面外に出た。
    画面の中に収め、中身が溢れたらダイアログの内側だけをスクロールする。
    見出しと操作ボタンは常に見えたままにする。
  */
  return (
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/45 p-4">
      <section data-design-node="zGZMA" data-design-part="archive-position" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[680px] flex-col overflow-hidden rounded-card border border-hairline bg-canvas shadow-2xl" role="alertdialog" aria-modal="true">
        <div className="flex items-start justify-between gap-3 p-4 pb-0">
          <div>
            <h2 className="text-lg font-bold text-ink">対応マーク「{mark.name}」を保管しますか？</h2>
            <p className="mt-2 text-xs leading-5 text-ink-secondary">保管後は新しく選べません。いま付いている友だちは、選んだマークへ置き換えて履歴を残します。</p>
          </div>
          <button type="button" onClick={onCancel} disabled={saving} aria-label="閉じる" className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-1 pt-3">
          {loading ? <p className="rounded-control bg-surface-soft p-3 text-sm text-ink-faint">影響を確認しています…</p> : impact ? (
            <div>
              <label className="block text-sm font-semibold text-ink">置き換え先
                <select value={replacementMarkId} onChange={(event) => onReplacement(event.target.value)} className="v6-select mt-1.5 h-10 w-full rounded-control border border-hairline bg-canvas px-3 font-normal">
                  <option value="">選んでください</option>
                  {impact.replacementOptions.map((option) => <option key={option.id} value={option.id}>{option.name}{option.isDefault ? '（初期値）' : ''}</option>)}
                </select>
              </label>
              {selected ? <p className="mt-2 text-xs text-ink-faint">{impact.friendCount}人を「{selected.name}」へ置き換えます。</p> : null}
            </div>
          ) : null}
          {error ? <Notice tone="danger" className="mt-4">{error}</Notice> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline p-4"><Button onClick={onCancel} disabled={saving}>やめる</Button><button type="button" onClick={onConfirm} disabled={loading || saving || !impact?.canArchive || !replacementMarkId} className="h-9 rounded-control bg-danger px-4 text-sm font-bold text-on-accent disabled:opacity-40">{saving ? '保管中…' : '置き換えて保管する'}</button></div>
      </section>
    </div>
  )
}

/**
 * ★V6 `rIhbN` 対応マーク一覧。
 *
 * 固定の対応状況（未対応・対応中・保留・対応済み）と、友だちに付ける対応マークは
 * 別の概念。ここは後者の設定だけを扱い、人数のKPIは既存の受信箱集計から読む。
 */
export default function SupportMarkList({ accountId }: { accountId: string | null }) {
  const [items, setItems] = useState<MarkRow[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  // 並び替え・保管の失敗は読み込み失敗と別に持つ（#1014 ATTR-02）。
  const [actionError, setActionError] = useState('')
  const [retryOrder, setRetryOrder] = useState<MarkRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [usage, setUsage] = useState<'all' | 'used' | 'unused'>('all')
  const [dragId, setDragId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MarkRow | null>(null)
  const [archiveImpact, setArchiveImpact] = useState<SupportMarkArchiveImpact | null>(null)
  const [replacementMarkId, setReplacementMarkId] = useState('')
  const [impactLoading, setImpactLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  /*
    ATTR-01: アカウント切替のあとに届いた古い応答で一覧を上書きしない。
    情報欄一覧と同じく、要求世代とアカウントの両方を応答時に照合する。
  */
  const gateRef = useRef(createResponseGate())
  const accountRef = useRef(accountId)
  accountRef.current = accountId

  /* 切替時は別アカウントの保管確認・掴み中の行を残さない。 */
  useEffect(() => {
    gateRef.current.invalidate()
    setPendingDelete(null)
    setArchiveImpact(null)
    setDragId(null)
    setError('')
    setActionError('')
    setRetryOrder(null)
    setDeleteError('')
  }, [accountId])

  const load = useCallback(async () => {
    const account = accountId
    const token = gateRef.current.begin()
    if (!account) {
      setItems([])
      setStatus('error')
      setError('LINE公式アカウントを選んでください')
      return
    }
    setStatus('loading')
    setError('')
    try {
      const res = await api.supportMarks.list(account)
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      if (!res.success) throw new Error(res.error)
      setItems(res.data)
      setStatus('ready')
    } catch (reason) {
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      setStatus(reason instanceof ApiError && reason.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => items.filter((mark) => {
    if (query && !mark.name.toLocaleLowerCase('ja').includes(query.toLocaleLowerCase('ja'))) return false
    if (usage === 'used' && !isUsed(mark)) return false
    if (usage === 'unused' && isUsed(mark)) return false
    return true
  }), [items, query, usage])

  /*
    並び替えは /api/support-marks/reorder へ「動かせる行だけの新しい順」を
    1回で渡す（#1014 ATTR-02/03/04）。

    以前は行ごとの PATCH で順位を書いていた。共有マークの PATCH は
    「複製＋付け替え」が走るので、並び替えただけで共有マークが複製され、
    途中失敗すると一部だけ順位が残っていた。共有マークは送らず、
    サーバー側で位置を固定したまま入れ替える。
  */
  const applyOrder = async (next: MarkRow[]) => {
    if (!accountId) return
    const account = accountId
    const previous = items
    setItems(next)
    setActionError('')
    setRetryOrder(null)
    try {
      const res = await api.supportMarks.reorder(account, movableIds(next, (mark) => !mark.isInherited))
      if (!res.success) throw new Error(res.error)
      await load()
    } catch (reason) {
      // 失敗した並びは保存済みと見せず元に戻す。理由と再試行は次の操作まで残す。
      setItems(previous)
      setActionError(reason instanceof ApiError ? `並び順を保存できませんでした（${reason.message}）` : '並び順を保存できませんでした')
      setRetryOrder(next)
    }
  }

  const move = async (targetId: string) => {
    if (!accountId || !dragId || dragId === targetId) return setDragId(null)
    const dragged = items.find((mark) => mark.id === dragId)
    const target = items.find((mark) => mark.id === targetId)
    if (dragged?.isInherited || target?.isInherited) {
      setDragId(null)
      setActionError('共有マークは、編集してこのアカウント専用にしてから並び替えてください')
      return
    }
    const order = visible.map((mark) => mark.id)
    const from = order.indexOf(dragId)
    const to = order.indexOf(targetId)
    setDragId(null)
    if (from < 0 || to < 0) return
    order.splice(to, 0, ...order.splice(from, 1))
    const visibleNext = order.map((id) => items.find((mark) => mark.id === id)).filter(Boolean) as MarkRow[]
    // 絞り込み中は見えている行だけを入れ替え、共有マークと隠れた行の位置を保つ。
    await applyOrder(mergeVisibleOrder(items, visibleNext, (mark) => mark.isInherited === true))
  }

  /** つまみにフォーカスして ↑/↓。共有マークに隣接する方向には動かさない（N-049）。 */
  const keyboardMove = async (id: string, direction: -1 | 1) => {
    const order = visible.map((mark) => mark.id)
    const from = order.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= order.length) return
    if (items.find((mark) => mark.id === order[to])?.isInherited) {
      setActionError('共有マークは、編集してこのアカウント専用にしてから並び替えてください')
      return
    }
    order.splice(to, 0, ...order.splice(from, 1))
    const visibleNext = order.map((i) => items.find((mark) => mark.id === i)).filter(Boolean) as MarkRow[]
    await applyOrder(mergeVisibleOrder(items, visibleNext, (mark) => mark.isInherited === true))
  }

  const openArchive = async (mark: MarkRow) => {
    const account = accountId
    if (!account) return
    const token = gateRef.current.begin()
    setPendingDelete(mark)
    setArchiveImpact(null)
    setReplacementMarkId('')
    setDeleteError('')
    setImpactLoading(true)
    try {
      const res = await api.supportMarks.archiveImpact(mark.id, account)
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      if (!res.success) throw new Error(res.error)
      setArchiveImpact(res.data)
      setReplacementMarkId(res.data.replacementOptions.find((option) => option.isDefault)?.id ?? res.data.replacementOptions[0]?.id ?? '')
    } catch {
      if (gateRef.current.current(token) && accountRef.current === account) {
        setDeleteError('保管の影響を確認できませんでした。画面を閉じて、もう一度お試しください。')
      }
    } finally {
      if (gateRef.current.current(token) && accountRef.current === account) setImpactLoading(false)
    }
  }

  const confirmRemove = async (mark: MarkRow) => {
    if (!accountId || !archiveImpact || !replacementMarkId || deleting) return
    setError('')
    setDeleteError('')
    setDeleting(true)
    try {
      const res = await api.supportMarks.archive(mark.id, accountId, {
        replacementMarkId,
        impactRevision: archiveImpact.impactRevision,
        expectedVersion: archiveImpact.expectedVersion,
      }, crypto.randomUUID())
      if (!res.success) throw new Error(res.error)
      setPendingDelete(null)
      setArchiveImpact(null)
      await load()
    } catch {
      setDeleteError('対応マークを保管できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  // 帯の「マークの種類・使用中」は、この一覧そのものから数える。
  const listReady = status === 'ready'
  const inUseCount = items.filter(isUsed).length
  const listStateDetail = status === 'forbidden'
    ? '見る権限がありません'
    : status === 'loading'
      ? '読み込んでいます'
      : '読み込めませんでした'

  return (
    <div data-design-node="rIhbN">
      <ListKpis
        key="support-marks"
        variant="v6"
        accountId={accountId}
        titles={['マークの種類', '未対応', '対応中', '過去7日の変更']}
        build={(stats) => [
          {
            title: 'マークの種類',
            /*
              **この2つは、いま下に並んでいる表そのものから数える。**
              別の集計口から取ると、表に5行あるのに帯は「0件・使用中0件」と
              出たまま、どちらが正しいのか画面から判断できなくなる。
              同じ画面に2つの数え方を置かない。
            */
            value: listReady ? items.length : null,
            unit: '件',
            detail: listReady ? `使用中 ${inUseCount}件` : listStateDetail,
          },
          {
            title: '未対応',
            value: stats.marks.unanswered,
            unit: '人',
            /*
              ATTR-21: 「未対応◯%」の母数は受信箱全体（未対応＋対応中＋
              保留＋対応済み）。以前はタグ付き友だち数で割っていたため、
              母数が別の集団になり100%を超えることがあった。母数が0や
              取れないときは「0%」と出さず「—」にする。
            */
            detail: (() => {
              const inboxTotal =
                stats.marks.unanswered + stats.marks.inProgress + (stats.marks.onHold ?? 0) + stats.marks.resolved
              return inboxTotal > 0
                ? `受信箱全体の ${Math.round((stats.marks.unanswered / inboxTotal) * 1000) / 10}%`
                : '受信箱全体の —'
            })(),
          },
          { title: '対応中', value: stats.marks.inProgress, unit: '人', detail: '担当者あり' },
          { title: '過去7日の変更', value: stats.marks.changedLast7, unit: '回', detail: '担当者別に記録' },
        ]}
      />

      {/*
        ATTR-21: 「未対応◯%」の KPI は受信箱の固定の対応状況
        （未対応・対応中・保留・対応済み）を数える。ここで設定する
        対応マークは、それとは別に友だちへ付ける印。同じ画面で
        2つの「対応」が混ざらないよう、帯で言い分ける。
      */}
      <NoteBar className="mb-4">
        受信箱の対応状況（未対応・対応中・保留・対応済み）はトークごとの決まった状態です。ここの対応マークは友だちに付ける印で、受信箱・友だち一覧・友だち詳細で共通利用し、自動変更と初期値を同じ画面で設定します。
      </NoteBar>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="マーク名で検索" aria-label="マーク名で検索" className="h-9 w-[150px] rounded-control border border-hairline bg-canvas px-3 text-label" />
        <select value={usage} onChange={(event) => setUsage(event.target.value as typeof usage)} className="v6-select h-9 w-[142px] rounded-control border border-hairline bg-canvas pl-3 text-label font-semibold text-ink" aria-label="利用状態">
          <option value="all">利用状態：すべて</option>
          <option value="used">使用中</option>
          <option value="unused">未使用</option>
        </select>
        <span className="flex-1" />
        {/* 追加ボタンはタブの右に1個だけ（#1014 ATTR-22）。一覧の中には置かない。 */}
      </div>

      {error ? <Notice tone="danger" className="mb-4">{error}</Notice> : null}
      {status === 'ready' && actionError ? (
        <Notice
          tone="danger"
          className="mb-4"
          action={retryOrder ? (
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => {
                const next = retryOrder
                setRetryOrder(null)
                if (next) void applyOrder(next)
              }}
            >
              再試行
            </button>
          ) : undefined}
        >
          {actionError}
        </Notice>
      ) : null}

      <div className="overflow-hidden rounded-card border border-hairline bg-canvas [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
        <div>
          {/* 960px以上は表。それ未満は縦に重ねたカード（#1014 ATTR-14）。 */}
          <table className="hidden w-full table-fixed text-sm md:table">
            <thead className="border-b border-hairline bg-canvas-sunken text-[11px] text-ink-faint">
              <tr>
                <Th className="w-12 px-3 py-3">順番</Th>
                <Th className="w-[15%] px-3 py-3">マーク</Th>
                <Th className="w-[8%] px-3 py-3">使用中</Th>
                <Th className="w-[10%] px-3 py-3">初期値</Th>
                <Th className="w-[16%] px-3 py-3">自動変更</Th>
                {/*
                  設計 `rIhbN` の見出しは「表示先」（受信箱・友だち一覧…と、
                  そのマークが**どの画面に出るか**）。それを返す口はまだ無い。
                  ここに出しているのは配信・シナリオからの**参照**なので、
                  見出しを中身に合わせて「使用先」と書く。
                  「表示先」は口ができてから戻す（引き継ぎメモに記載）。
                */}
                <Th className="px-3 py-3">表示先</Th>
                <Th className="w-16 px-3 py-3">操作</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {status === 'loading' ? (
                <tr><td colSpan={7} className="p-0"><ListState kind="loading" /></td></tr>
              ) : status === 'forbidden' ? (
                <tr><td colSpan={7} className="p-0"><ListState kind="forbidden" description="対応マークを見る権限がありません。オーナーか管理者に確認してください。" /></td></tr>
              ) : status === 'error' ? (
                <tr><td colSpan={7} className="p-0"><ListState kind="error" description="対応マークを読み込めませんでした。再読み込みしてください。" onRetry={() => void load()} /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="p-0"><ListState kind="empty" title="まだ対応マークがありません" description="「＋ マークを作る」から最初のマークを作ってください。" /></td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={7} className="p-0"><ListState kind="empty" title="条件に合う対応マークはありません" description="検索語か利用状態を変えてください。" /></td></tr>
              ) : visible.map((mark) => (
                <tr key={mark.id} className="hover:bg-canvas-sunken">
                  <td draggable={!mark.isInherited} onDragStart={() => setDragId(mark.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => void move(mark.id)} className={`${mark.isInherited ? 'cursor-not-allowed' : 'cursor-grab'} px-3 py-3 text-hairline`} title={mark.isInherited ? '共有マークは編集後に並び替えできます' : undefined}>
                    <ReorderGrip label={mark.name} disabled={mark.isInherited} disabledReason="共有マークは編集後に並び替えできます" onMove={(direction) => void keyboardMove(mark.id, direction)} />
                  </td>
                  <td className="px-3 py-3">
                    <Link href={`/tags/marks/edit?id=${encodeURIComponent(mark.id)}`} className="inline-flex max-w-full items-center rounded-pill px-2.5 py-1 text-xs font-bold hover:opacity-80" style={{ backgroundColor: `${mark.color}1A`, color: mark.color }} title={mark.name}>
                      <span className="truncate">{mark.name}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">{mark.friendCount}人</td>
                  <td className="px-3 py-3 text-ink">{mark.isDefault ? '新着時の初期値' : '—'}</td>
                  <td className="px-3 py-3 text-ink">{autoRuleLabel(mark)}</td>
                  <td className="truncate px-3 py-3 text-ink" title={usageLabel(mark)}>{usageLabel(mark)}</td>
                  <td className="px-3 py-3 text-center">
                    {mark.isDefault || mark.isInherited ? (
                      <span title={mark.isDefault ? '初期値のマークは保管できません' : '共有マークは編集後に保管できます'} className="inline-flex text-ink-faint"><LockKeyhole size={18} aria-label={mark.isDefault ? '初期値のため保管できません' : '共有マークのため保管できません'} /></span>
                    ) : (
                      <button type="button" onClick={() => void openArchive(mark)} aria-label={`${mark.name}を保管`} className="text-danger hover:opacity-70"><Trash2 size={18} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* 狭い画面でも、読込・失敗・0件の案内は表と同じ言葉で出す。 */}
          {status !== 'ready' || items.length === 0 || visible.length === 0 ? (
            <div className="md:hidden">
              {status === 'loading' ? <ListState kind="loading" />
                : status === 'forbidden' ? <ListState kind="forbidden" description="対応マークを見る権限がありません。オーナーか管理者に確認してください。" />
                : status === 'error' ? <ListState kind="error" description="対応マークを読み込めませんでした。再読み込みしてください。" onRetry={() => void load()} />
                : items.length === 0 ? <ListState kind="empty" title="まだ対応マークがありません" description="「＋ マークを作る」から最初のマークを作ってください。" />
                : <ListState kind="empty" title="条件に合う対応マークはありません" description="検索語か利用状態を変えてください。" />}
            </div>
          ) : null}
          {/*
            960px未満は縦に重ねたカード（#1014 ATTR-14）。
            表をそのまま小さくすると操作列まで届かなかった。
          */}
          {status === 'ready' && visible.length > 0 ? (
            <ul className="divide-y divide-hairline md:hidden">
              {visible.map((mark) => (
                <li key={mark.id} className="px-3 py-3">
                  <div className="flex items-start gap-2">
                    <span className="pt-1 text-hairline" title={mark.isInherited ? '共有マークは編集後に並び替えできます' : undefined}>
                      <ReorderGrip label={mark.name} disabled={mark.isInherited} disabledReason="共有マークは編集後に並び替えできます" onMove={(direction) => void keyboardMove(mark.id, direction)} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/tags/marks/edit?id=${encodeURIComponent(mark.id)}`} className="inline-flex max-w-full items-center rounded-pill px-2.5 py-1 text-xs font-bold hover:opacity-80" style={{ backgroundColor: `${mark.color}1A`, color: mark.color }} title={mark.name}>
                        <span className="truncate">{mark.name}</span>
                      </Link>
                      <p className="mt-1 text-xs text-ink-secondary">使用中 {mark.friendCount}人・{mark.isDefault ? '新着時の初期値' : '初期値なし'}</p>
                      <p className="text-xs text-ink-faint">自動変更：{autoRuleLabel(mark)}・{usageLabel(mark)}</p>
                    </div>
                    <div className="shrink-0 pt-1">
                      {mark.isDefault || mark.isInherited ? (
                        <span title={mark.isDefault ? '初期値のマークは保管できません' : '共有マークは編集後に保管できます'} className="inline-flex text-ink-faint"><LockKeyhole size={18} aria-label={mark.isDefault ? '初期値のため保管できません' : '共有マークのため保管できません'} /></span>
                      ) : (
                        <button type="button" onClick={() => void openArchive(mark)} aria-label={`${mark.name}を保管`} className="text-danger hover:opacity-70"><Trash2 size={18} /></button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <section className="mt-4 rounded-card border border-hairline bg-canvas px-5 py-4 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
        <h2 className="text-sm font-bold text-ink">受信時自動変更・保管・初期値の安全確認</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">「受信時に変更」の設定は追加・編集画面で確認できます。保管時は影響人数と置き換え先を表示し、初期値は保管できません。</p>
      </section>

      {pendingDelete ? <ArchiveMarkDialog mark={pendingDelete} impact={archiveImpact} replacementMarkId={replacementMarkId} loading={impactLoading} saving={deleting} error={deleteError} onReplacement={setReplacementMarkId} onCancel={() => { if (!deleting) { setPendingDelete(null); setArchiveImpact(null) } }} onConfirm={() => void confirmRemove(pendingDelete)} /> : null}
    </div>
  )
}
