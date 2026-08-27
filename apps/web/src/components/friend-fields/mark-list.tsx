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

function usageLabel(mark: MarkRow): string {
  const parts: string[] = []
  if (mark.friendCount > 0) parts.push(`友だち${mark.friendCount}`)
  if (mark.usedIn?.broadcasts) parts.push(`配信${mark.usedIn.broadcasts}`)
  if (mark.usedIn?.scenarios) parts.push(`シナリオ${mark.usedIn.scenarios}`)
  if (mark.usedIn?.autoReplies) parts.push(`自動応答${mark.usedIn.autoReplies}`)
  if (mark.usedIn?.savedSearches) parts.push(`保存検索${mark.usedIn.savedSearches}`)
  if (mark.usedIn?.automations) parts.push(`自動化${mark.usedIn.automations}`)
  return parts.length ? parts.join('・') : 'なし'
}

/**
 * ★V6 `rIhbN` 対応マーク一覧。
 *
 * 固定の対応状況（未対応・対応中・解決済）と、友だちに付ける対応マークは
 * 別の概念。ここは後者の設定だけを扱い、人数のKPIは既存の受信箱集計から読む。
 */
export default function SupportMarkList() {
  const [items, setItems] = useState<MarkRow[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [usage, setUsage] = useState<'all' | 'used' | 'unused'>('all')
  const [dragId, setDragId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MarkRow | null>(null)
  const defaultMark = items.find((item) => item.isDefault)

  const load = useCallback(async () => {
    setStatus('loading')
    setError('')
    try {
      const res = await api.supportMarks.list()
      if (!res.success) throw new Error(res.error)
      setItems(res.data)
      setStatus('ready')
    } catch (reason) {
      setStatus(reason instanceof ApiError && reason.status === 403 ? 'forbidden' : 'error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => items.filter((mark) => {
    if (query && !mark.name.toLocaleLowerCase('ja').includes(query.toLocaleLowerCase('ja'))) return false
    if (usage === 'used' && mark.friendCount === 0) return false
    if (usage === 'unused' && mark.friendCount > 0) return false
    return true
  }), [items, query, usage])

  const move = async (targetId: string) => {
    if (!dragId || dragId === targetId) return setDragId(null)
    const order = visible.map((mark) => mark.id)
    const from = order.indexOf(dragId)
    const to = order.indexOf(targetId)
    setDragId(null)
    if (from < 0 || to < 0) return
    order.splice(to, 0, ...order.splice(from, 1))
    const next = order.map((id) => items.find((mark) => mark.id === id)).filter(Boolean) as MarkRow[]
    setItems(next)
    try {
      await Promise.all(next.map((mark, index) => api.supportMarks.update(mark.id, { displayOrder: index })))
      await load()
    } catch {
      setError('並び順を保存できませんでした')
      await load()
    }
  }

  const confirmRemove = async (mark: MarkRow) => {
    setError('')
    try {
      const res = await api.supportMarks.delete(mark.id, { force: mark.friendCount > 0 })
      if (!res.success) throw new Error(res.error)
      await load()
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '削除できませんでした')
    }
  }

  return (
    <div data-design-node="rIhbN">
      <ListKpis
        key="support-marks"
        variant="v6"
        titles={['マークの種類', '未対応', '対応中', '過去7日の変更']}
        build={(stats) => [
          { title: 'マークの種類', value: stats.marks.total, unit: '件', detail: `使用中 ${stats.marks.inUse}件` },
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
                <tr><td colSpan={7} className="p-0"><ListState kind="error" description="対応マークを読み込めませんでした。再読み込みしてください。" /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="p-0"><ListState kind="empty" title="まだ対応マークがありません" description="「＋ マークを追加」から最初のマークを作ってください。" /></td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={7} className="p-0"><ListState kind="empty" title="条件に合う対応マークはありません" description="検索語か利用状態を変えてください。" /></td></tr>
              ) : visible.map((mark) => (
                <tr key={mark.id} className="hover:bg-canvas-sunken">
                  <td draggable onDragStart={() => setDragId(mark.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => void move(mark.id)} className="cursor-grab px-3 py-3 text-hairline" aria-label={`${mark.name}をドラッグして並び替え`}>
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
                    {mark.isDefault ? (
                      <span title="初期値のマークは削除できません" className="inline-flex text-ink-faint"><LockKeyhole size={18} aria-label="初期値のため削除できません" /></span>
                    ) : (
                      <button type="button" onClick={() => setPendingDelete(mark)} aria-label={`${mark.name}を削除`} className="text-danger hover:opacity-70"><Trash2 size={18} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <section className="mt-4 rounded-card border border-hairline bg-canvas px-5 py-4 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
        <h2 className="text-sm font-bold text-ink">受信時自動変更・削除・初期値の安全確認</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">「受信時に変更」の設定は追加・編集画面で確認できます。削除時は影響人数と置き換え先を表示し、初期値は削除できません。</p>
      </section>

      <ConfirmDialog open={pendingDelete !== null} title={`対応マーク「${pendingDelete?.name ?? ''}」を削除しますか？`} description={(pendingDelete?.friendCount ?? 0) > 0 ? `${pendingDelete?.friendCount ?? 0} 人の対応マークは、削除後に「${defaultMark?.name ?? '初期値'}」へ変更されます。この操作は元に戻せません。` : 'この対応マークを削除します。この操作は元に戻せません。'} confirmLabel="削除する" destructive onCancel={() => setPendingDelete(null)} onConfirm={() => { const target = pendingDelete; setPendingDelete(null); if (target) void confirmRemove(target) }} />
    </div>
  )
}
