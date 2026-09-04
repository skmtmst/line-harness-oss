'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { GripVertical, LockKeyhole, Trash2 } from 'lucide-react'
import type { SupportMark } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListKpis from '@/components/shared/list-kpis'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { Th } from '@/components/shared/table'

type MarkRow = SupportMark & { friendCount: number }
type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

function autoRuleLabel(mark: MarkRow): string {
  return mark.autoOnInbound ? '受信時' : '—'
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
  if (mark.usedIn === undefined) return '—'
  const parts: string[] = []
  if (mark.usedIn.broadcasts) parts.push(`配信${mark.usedIn.broadcasts}件`)
  if (mark.usedIn.scenarios) parts.push(`シナリオ${mark.usedIn.scenarios}件`)
  if (mark.usedIn.autoReplies) parts.push(`自動応答${mark.usedIn.autoReplies}件`)
  if (mark.usedIn.savedSearches) parts.push(`保存検索${mark.usedIn.savedSearches}件`)
  if (mark.usedIn.automations) parts.push(`自動化${mark.usedIn.automations}件`)
  return parts.length ? parts.join('・') : 'なし'
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
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const defaultMark = items.find((item) => item.isDefault)

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

  const confirmRemove = async (mark: MarkRow) => {
    if (!accountId || !defaultMark || deleting || referenceCount(mark) > 0) return
    setError('')
    setDeleteError('')
    setDeleting(true)
    try {
      const res = await api.supportMarks.delete(mark.id, accountId, {
        replacementMarkId: defaultMark.id,
        expectedImpact: {
          friendCount: mark.friendCount,
          usedIn: {
            broadcasts: mark.usedIn?.broadcasts ?? 0,
            scenarios: mark.usedIn?.scenarios ?? 0,
            autoReplies: mark.usedIn?.autoReplies ?? 0,
            savedSearches: mark.usedIn?.savedSearches ?? 0,
            automations: mark.usedIn?.automations ?? 0,
          },
        },
      })
      if (!res.success) throw new Error(res.error)
      setPendingDelete(null)
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
                <Th className="px-3 py-3">使用先</Th>
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
                      <button type="button" onClick={() => { setDeleteError(''); setPendingDelete(mark) }} aria-label={`${mark.name}を保管`} className="text-danger hover:opacity-70"><Trash2 size={18} /></button>
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

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`対応マーク「${pendingDelete?.name ?? ''}」を保管しますか？`}
        description={pendingDelete && referenceCount(pendingDelete) > 0
          ? `配信など${referenceCount(pendingDelete)}件で使われているため保管できません。先にすべての使用先から外してください。友だちのマークと設定は変更されません。`
          : `${pendingDelete?.friendCount ?? 0}人の友だちは「${defaultMark?.name ?? '初期値'}」へ変更されます。マークは今後の選択肢から外れ、変更履歴は残ります。この操作は画面から元に戻せません。`}
        confirmLabel="保管する"
        destructive
        busy={deleting}
        error={deleteError}
        onCancel={() => { if (!deleting) setPendingDelete(null) }}
        onConfirm={defaultMark && pendingDelete && referenceCount(pendingDelete) === 0
          ? () => { void confirmRemove(pendingDelete) }
          : undefined}
      />
    </div>
  )
}
