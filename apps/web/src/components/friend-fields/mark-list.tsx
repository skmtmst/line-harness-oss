'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { GripVertical, LockKeyhole, Trash2 } from 'lucide-react'
import { api, ApiError, type SupportMarkArchiveImpact, type SupportMarkListItem } from '@/lib/api'
import Button from '@/components/shared/button'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import ListKpis from '@/components/shared/list-kpis'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
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
  return (
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4">
      <section className="w-full max-w-2xl rounded-card border border-hairline bg-canvas p-7 shadow-2xl" role="alertdialog" aria-modal="true">
        <h2 className="text-xl font-bold text-ink">対応マーク「{mark.name}」を保管しますか？</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">保管後は新しく選べません。いま付いている友だちは、選んだマークへ置き換えて履歴を残します。</p>
        {loading ? <p className="mt-5 rounded-control bg-surface-soft p-4 text-sm text-ink-faint">影響を確認しています…</p> : impact ? (
          <div className="mt-5 space-y-4">
            <dl className="divide-y divide-hairline overflow-hidden rounded-control border border-hairline text-sm">
              <div className="flex justify-between px-4 py-3"><dt className="text-ink-secondary">置き換える友だち</dt><dd className="font-bold">{impact.friendCount}人</dd></div>
              <div className="flex justify-between px-4 py-3"><dt className="text-ink-secondary">自動変更ルール</dt><dd className="font-bold">{impact.automationRules.length}件</dd></div>
              <div className="flex justify-between px-4 py-3"><dt className="text-ink-secondary">表示先</dt><dd className="max-w-md text-right font-bold">{impact.displayTargets.map((target) => DISPLAY_TARGET_LABELS[target]).join('・')}</dd></div>
            </dl>
            <label className="block text-sm font-semibold text-ink">置き換え先
              <select value={replacementMarkId} onChange={(event) => onReplacement(event.target.value)} className="v6-select mt-1.5 h-10 w-full rounded-control border border-hairline bg-canvas px-3 font-normal">
                <option value="">選んでください</option>
                {impact.replacementOptions.map((option) => <option key={option.id} value={option.id}>{option.name}{option.isDefault ? '（初期値）' : ''}</option>)}
              </select>
            </label>
            {selected ? <p className="text-xs text-ink-faint">{impact.friendCount}人を「{selected.name}」へ置き換えます。</p> : null}
          </div>
        ) : null}
        {error ? <p role="alert" className="mt-4 rounded-control border border-danger/20 bg-danger-bg p-3 text-sm text-danger">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2"><Button onClick={onCancel} disabled={saving}>やめる</Button><button type="button" onClick={onConfirm} disabled={loading || saving || !impact?.canArchive || !replacementMarkId} className="rounded-control bg-danger px-4 py-2.5 text-sm font-bold text-on-accent disabled:opacity-40">{saving ? '保管中…' : '置き換えて保管する'}</button></div>
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
  const [query, setQuery] = useState('')
  const [usage, setUsage] = useState<'all' | 'used' | 'unused'>('all')
  const [dragId, setDragId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MarkRow | null>(null)
  const [archiveImpact, setArchiveImpact] = useState<SupportMarkArchiveImpact | null>(null)
  const [replacementMarkId, setReplacementMarkId] = useState('')
  const [impactLoading, setImpactLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(async () => {
    if (!accountId) {
      setItems([])
      setStatus('error')
      setError('LINE公式アカウントを選んでください')
      return
    }
    setStatus('loading')
    setError('')
    try {
      const res = await api.supportMarks.list(accountId)
      if (!res.success) throw new Error(res.error)
      setItems(res.data)
      setStatus('ready')
    } catch (reason) {
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

  const move = async (targetId: string) => {
    if (!accountId || !dragId || dragId === targetId) return setDragId(null)
    const dragged = items.find((mark) => mark.id === dragId)
    const target = items.find((mark) => mark.id === targetId)
    if (dragged?.isInherited || target?.isInherited) {
      setDragId(null)
      setError('共有マークは、編集してこのアカウント専用にしてから並び替えてください')
      return
    }
    const order = visible.map((mark) => mark.id)
    const from = order.indexOf(dragId)
    const to = order.indexOf(targetId)
    setDragId(null)
    if (from < 0 || to < 0) return
    order.splice(to, 0, ...order.splice(from, 1))
    const next = order.map((id) => items.find((mark) => mark.id === id)).filter(Boolean) as MarkRow[]
    setItems(next)
    try {
      await Promise.all(
        next.map((mark, index) =>
          api.supportMarks.update(mark.id, accountId, { displayOrder: index }),
        ),
      )
      await load()
    } catch {
      setError('並び順を保存できませんでした')
      await load()
    }
  }

  const openArchive = async (mark: MarkRow) => {
    if (!accountId) return
    setPendingDelete(mark)
    setArchiveImpact(null)
    setReplacementMarkId('')
    setDeleteError('')
    setImpactLoading(true)
    try {
      const res = await api.supportMarks.archiveImpact(mark.id, accountId)
      if (!res.success) throw new Error(res.error)
      setArchiveImpact(res.data)
      setReplacementMarkId(res.data.replacementOptions.find((option) => option.isDefault)?.id ?? res.data.replacementOptions[0]?.id ?? '')
    } catch {
      setDeleteError('保管の影響を確認できませんでした。画面を閉じて、もう一度お試しください。')
    } finally { setImpactLoading(false) }
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
            detail: stats.tags.taggedFriends > 0
              ? `全体の ${Math.round((stats.marks.unanswered / stats.tags.taggedFriends) * 1000) / 10}%`
              : '全体の —',
          },
          { title: '対応中', value: stats.marks.inProgress, unit: '人', detail: '担当者あり' },
          { title: '過去7日の変更', value: stats.marks.changedLast7, unit: '回', detail: '担当者別に記録' },
        ]}
      />

      <NoteBar className="mb-4">
        受信箱・友だち一覧・友だち詳細で共通利用し、メッセージ受信時の自動変更と初期値を同じ画面で設定します。
      </NoteBar>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="マーク名で検索" aria-label="マーク名で検索" className="h-9 w-[150px] rounded-control border border-hairline bg-canvas px-3 text-label outline-none focus:border-accent" />
        <select value={usage} onChange={(event) => setUsage(event.target.value as typeof usage)} className="v6-select h-9 w-[142px] rounded-control border border-hairline bg-canvas pl-3 text-label font-semibold text-ink" aria-label="利用状態">
          <option value="all">利用状態：すべて</option>
          <option value="used">使用中</option>
          <option value="unused">未使用</option>
        </select>
        <span className="flex-1" />
        {status === 'forbidden' ? null : <Button href="/tags/marks/new" variant="primary">＋ マークを追加</Button>}
      </div>

      {error ? <p role="alert" className="mb-4 rounded-control border border-danger/20 bg-danger-bg p-3 text-sm text-danger">{error}</p> : null}

      <div className="overflow-hidden rounded-card border border-hairline bg-canvas [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
        <div>
          <table className="w-full table-fixed text-sm">
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
                <tr><td colSpan={7} className="p-0"><ListState kind="empty" title="まだ対応マークがありません" description="「＋ マークを追加」から最初のマークを作ってください。" /></td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={7} className="p-0"><ListState kind="empty" title="条件に合う対応マークはありません" description="検索語か利用状態を変えてください。" /></td></tr>
              ) : visible.map((mark) => (
                <tr key={mark.id} className="hover:bg-canvas-sunken">
                  <td draggable={!mark.isInherited} onDragStart={() => setDragId(mark.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => void move(mark.id)} className={`${mark.isInherited ? 'cursor-not-allowed' : 'cursor-grab'} px-3 py-3 text-hairline`} aria-label={mark.isInherited ? `${mark.name}は編集後に並び替えできます` : `${mark.name}をドラッグして並び替え`} title={mark.isInherited ? '共有マークは編集後に並び替えできます' : undefined}>
                    <GripVertical size={16} aria-hidden="true" />
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
