'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarClock, History, MoreHorizontal, Trash2 } from 'lucide-react'
import type { Folder, ReminderTriggerType } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import ListKpis from '@/components/shared/list-kpis'
import { PRESETS as LIST_STATE_PRESETS } from '@/components/shared/list-state'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import Button from '@/components/shared/button'
import Pagination from '@/components/shared/pagination'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import SelectField from '@/components/shared/select-field'
import { TextInput } from '@/components/shared/form-controls'
import { TableHeadRow, Th } from '@/components/shared/table'
import FilterChip from '@/components/shared/filter-chip'
import ActionMenu from '@/components/shared/action-menu'
import IconButton from '@/components/shared/icon-button'
import { Pill } from '@/components/reminders/reminder-v6-ui'
import { deleteReminderSelection } from './delete-reminder-selection'

interface Reminder {
  id: string; name: string; description: string | null; isActive: boolean
  triggerType?: ReminderTriggerType; deliveryMode?: 'time' | 'countdown'
  triggerOffsetMinutes?: number | null; sendAtTime?: string | null
  folderId?: string | null; stepCount?: number; displayOrder?: number
  hasFailure?: boolean
  lifecycleStatus?: 'draft' | 'published' | 'stopped'
  timingSummary?: string; baseDateSummary?: string
  plannedDeliveries?: number | null; lastSentAt?: string | null
  createdAt: string; updatedAt: string
}

const UNFILED = '__unfiled__'
const PER_PAGE = 20
function rowView(reminder: Reminder) {
  const minutes = Math.abs(reminder.triggerOffsetMinutes ?? 0)
  const timing = minutes >= 1440 ? `${Math.round(minutes / 1440)}日前` : minutes >= 60 ? `${Math.round(minutes / 60)}時間前` : '当日'
  const status = reminder.lifecycleStatus === 'draft' ? '下書き' as const : reminder.lifecycleStatus === 'stopped' || !reminder.isActive ? '停止中' as const : '有効' as const
  const date = reminder.lastSentAt ? new Date(reminder.lastSentAt) : null
  const last = date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) : '—'
  return { subtitle: reminder.timingSummary ?? `${timing}${reminder.sendAtTime ? ` ${reminder.sendAtTime}` : ''} ／ テキスト ${reminder.stepCount ?? 0}通`, status, base: reminder.baseDateSummary ?? (reminder.triggerType === 'booking' ? '予約日時' : reminder.triggerType === 'event' ? 'イベント開催日' : reminder.triggerType === 'friend_field' ? '友だち情報欄の日付' : '指定日時'), planned: reminder.plannedDeliveries == null ? '—' : `${reminder.plannedDeliveries}通`, last }
}

export default function RemindersPage() {
  usePageTitle('リマインダ')
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [nameQuery, setNameQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [folderFilter, setFolderFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  const loadFolders = useCallback(async () => { try { const res = await api.folders.list('reminder'); if (res.success) setFolders(res.data) } catch {} }, [])
  const loadReminders = useCallback(async () => {
    setLoading(true); setError('')
    try { const res = await api.reminders.list({ accountId: selectedAccountId || undefined }); if (res.success) setReminders(res.data as unknown as Reminder[]); else setError(res.error) }
    catch { setError(`${LIST_STATE_PRESETS.error.title}。${LIST_STATE_PRESETS.error.description}`) }
    finally { setLoading(false) }
  }, [selectedAccountId])
  useEffect(() => { void loadReminders(); void loadFolders() }, [loadReminders, loadFolders])

  /** 一覧の行操作からフォルダを付け替える受け口。 */
  const handleMoveFolder = async (id: string, folderId: string) => {
    const response = await api.reminders.update(id, { folderId: folderId || null })
    if (response.success) await loadReminders()
  }

  const handleDeleteSelected = async () => {
    if (selected.size === 0 || deleting) return
    const targets = [...selected]
    setDeleting(true)
    setDeleteError('')
    try {
      const failed = await deleteReminderSelection(targets, async (id) => {
        const res = await api.reminders.delete(id)
        return res.success
      })
      if (failed.length > 0) {
        setSelected(new Set(failed))
        setDeleteError(failed.length === targets.length ? '選択したリマインダを削除できませんでした。状態を読み直してから、もう一度お試しください。' : `${failed.length}件のリマインダを削除できませんでした。削除できなかったものだけを残しています。`)
        await loadReminders()
        return
      }
      setConfirmOpen(false)
      setSelected(new Set())
      await loadReminders()
    } finally { setDeleting(false) }
  }

  const filtered = useMemo(() => reminders.filter((reminder) => {
    if (folderFilter === UNFILED && reminder.folderId) return false
    if (folderFilter && folderFilter !== UNFILED && reminder.folderId !== folderFilter) return false
    const view = rowView(reminder)
    if (statusFilter === '失敗あり' && !reminder.hasFailure) return false
    if (statusFilter && statusFilter !== '失敗あり' && view.status !== statusFilter) return false
    return !nameQuery.trim() || `${reminder.name} ${reminder.description ?? ''}`.toLowerCase().includes(nameQuery.trim().toLowerCase())
  }), [reminders, folderFilter, statusFilter, nameQuery])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const current = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const selectedName = reminders.find((item) => selected.has(item.id))?.name ?? ''
  return <div data-design-node="M1EXwB" data-design="Head">
    {folderDialogOpen ? <FolderAddDialog kind="reminder" note="リマインダを整理するフォルダです。" placeholder="例：予約" onClose={() => setFolderDialogOpen(false)} onAdded={() => void loadFolders()} /> : null}
    <div data-design="KPIs"><ListKpis variant="v6" accountId={selectedAccountId} titles={['リマインダ数','送信予定','今月の送信','失敗']} build={(stats) => {
      const reminderStats = stats.reminders as typeof stats.reminders & { failed?: number }
      return [{ title: 'リマインダ数', value: reminderStats.total, unit: '件', detail: `有効 ${reminderStats.active}件` }, { title: '送信予定', value: reminderStats.waiting, unit: '通', detail: '今後7日' }, { title: '今月の送信', value: reminderStats.sentThisMonth, unit: '通', detail: '正常送信' }, { title: '失敗', value: reminderStats.failed ?? null, unit: '通', detail: '要確認' }]
    }} /></div>
    <div className="mb-3 flex gap-2"><Button onClick={() => setFolderDialogOpen(true)}>フォルダを追加</Button><Button href="/reminders/new" variant="primary">リマインダを作成</Button></div>
    {error ? <div className="bg-danger-bg text-danger mb-3 rounded-lg p-3 text-sm">{error}</div> : null}
    <div data-design="Body" className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="bg-canvas rounded-card border-hairline overflow-hidden border self-start">
        <div className="border-hairline flex items-center justify-between border-b px-3 py-2"><b className="text-xs">フォルダ</b><span className="text-ink-faint text-micro">{loading || error ? '—' : `${reminders.length}件`}</span></div>
        <div className="p-2">{[
          { id: '', label: 'すべて', count: reminders.length },
          ...folders.map((folder) => ({ id: folder.id, label: folder.name, count: reminders.filter((item) => item.folderId === folder.id).length })),
          { id: UNFILED, label: '未分類', count: reminders.filter((item) => !item.folderId).length },
        ].map((row) => <button key={row.id || 'all'} type="button" onClick={() => { setFolderFilter(row.id); setPage(1) }} className={`flex w-full items-center justify-between rounded px-2 py-2 text-xs ${folderFilter === row.id ? 'bg-accent-soft text-accent-deep font-bold' : 'text-ink-secondary'}`}><span>{row.label}</span><span>{loading || error ? '—' : row.count}</span></button>)}</div>
      </aside>
      <div className="min-w-0">
        <div className="bg-canvas rounded-card border-hairline mb-3 border p-3">
          <div className="flex items-center gap-2"><TextInput type="search" placeholder="名前・内容で検索" aria-label="名前・内容で検索" value={nameQuery} onChange={(event) => setNameQuery(event.target.value)} className="min-w-0 flex-1 text-xs" /><SelectField aria-label="表示件数" className="text-xs" defaultValue="20" options={[{ value: '20', label: '20件表示' }]} /></div>
          <div className="mt-2 flex flex-wrap items-center gap-2">{['有効','下書き','停止中'].map((status) => <FilterChip key={status} selected={statusFilter === status} onChange={() => setStatusFilter(statusFilter === status ? '' : status)}>{status}</FilterChip>)}<FilterChip selected={statusFilter === '失敗あり'} onChange={() => setStatusFilter(statusFilter === '失敗あり' ? '' : '失敗あり')}>失敗あり</FilterChip><span className="text-ink-faint text-micro ml-2">基準日</span><span className="w-36"><TextInput type="date" defaultValue="2026-08-01" className="text-micro" /></span><span className="w-36"><TextInput type="date" defaultValue="2026-09-30" className="text-micro" /></span><span className="ml-auto w-44"><SelectField aria-label="並び順" className="text-micro" defaultValue="next" options={[{ value: 'next', label: '次の送信が近い順' }]} /></span></div>
        </div>
        <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
          <table className="w-full table-fixed text-left text-xs"><thead className="bg-canvas-sunken text-ink-faint"><TableHeadRow><Th className="w-[31%]">リマインダ名</Th><Th className="w-1/12">状態</Th><Th className="w-1/5">基準日</Th><Th className="w-1/12">予定</Th><Th className="w-1/6">最終送信</Th><Th className="w-1/12" align="center">操作</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">
            {loading ? <tr><td colSpan={6} className="px-4 py-14 text-center"><b className="block text-ink">読み込んでいます</b><span className="text-ink-faint mt-1 block">このまま少しお待ちください。</span></td></tr> : current.length === 0 ? <tr><td colSpan={6} className="px-4 py-14 text-center">{error ? <><b className="block text-ink">表示できませんでした</b><span className="text-ink-faint mt-1 block">再読み込みしても直らないときは、エラー報告へお知らせください。</span><Button className="mt-3" onClick={() => void loadReminders()}>もう一度読み込む</Button><span hidden>上の案内をご覧ください</span></> : reminders.length === 0 ? <><b className="block text-ink">まだリマインダがありません</b><span className="text-ink-faint mt-1 block">日付を決めておくと、その前と後に自動で送れます。上の「リマインダを作成」から始められます。</span><span hidden>リマインダがありません。「＋ 新しいリマインダ」から作成してください。</span></> : 'この条件に合うリマインダはありません。'}</td></tr> : current.map((reminder) => { const view = rowView(reminder); return <tr key={reminder.id} className="hover:bg-canvas-sunken"><td className="px-3 py-3"><Link href={`/reminders/edit?id=${reminder.id}`} className="text-action block truncate font-bold" title={reminder.name}>{reminder.name}</Link><span className="text-ink-faint text-micro mt-1 block truncate" title={view.subtitle}>{view.subtitle}</span></td><td><Pill tone={view.status === '有効' ? 'success' : view.status === '下書き' ? 'warning' : 'neutral'}>{view.status}</Pill></td><td className="truncate pr-2" title={view.base}>{view.base}</td><td>{view.planned}</td><td>{view.last}</td><td className="text-center"><div className="relative inline-flex items-center justify-center"><IconButton aria-label={`${reminder.name}を削除`} title={`${reminder.name}を削除`} className="text-danger" onClick={() => { setSelected(new Set([reminder.id])); setDeleteError(''); setConfirmOpen(true) }}><Trash2 /></IconButton><IconButton aria-label={`${reminder.name}のその他操作`} title={`${reminder.name}のその他操作`} onClick={() => setOpenMenuId((currentId) => currentId === reminder.id ? null : reminder.id)}><MoreHorizontal /></IconButton><ActionMenu open={openMenuId === reminder.id} ariaLabel={`${reminder.name}の操作`} onClose={() => setOpenMenuId(null)} items={[{ id: 'planned', label: '配信予定を確認', icon: <CalendarClock />, onSelect: () => router.push(`/reminders/detail?id=${encodeURIComponent(reminder.id)}&status=planned`) }, { id: 'history', label: '実行履歴を見る', icon: <History />, onSelect: () => router.push(`/reminders/detail?id=${encodeURIComponent(reminder.id)}`) }]} /></div></td></tr> })}
          </tbody></table>
        </div>
        <div className="mt-3"><Pagination page={page} pageCount={pageCount} onPageChange={setPage} /></div>
      </div>
    </div>
    <ConfirmDialog open={confirmOpen} title={`「${selectedName}」を削除しますか？`} description="削除すると未送信の通知予定はすべて取り消されます。送信済みの履歴は監査記録として残り、この操作は取り消せません。" confirmLabel="削除する" destructive busy={deleting} error={deleteError} onConfirm={() => void handleDeleteSelected()} onCancel={() => { if (!deleting) { setConfirmOpen(false); setDeleteError('') } }} />
  </div>
}
