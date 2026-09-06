'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { Tabs } from '@/components/shared/tabs'
import { TableHeadRow, Th } from '@/components/shared/table'
import { api } from '@/lib/api'

interface Row {
  id: string
  adminUserId: string | null
  userName: string
  role: 'admin' | 'staff' | 'viewer' | null
  lineLinked: boolean
  isActive: boolean
  action: string
  screen: string | null
  ip: string | null
  connectionSource: string | null
  result: string
  createdAt: string
}

const ACTIONS: Record<string, string> = {
  login: 'ログインしました', logout: 'ログアウトしました', fail: 'ログインに失敗しました',
  view_personal: '個人情報を表示しました', export: 'CSVを書き出しました',
  settings_changed: '設定を変えました', broadcast_sent: '一斉配信を出しました', delete: 'テンプレートを消しました',
}
const ROLES: Record<string, string> = { admin: '管理者', staff: '運用', viewer: '見るだけ' }
const PERIOD_OPTIONS = [
  { value: '30', label: 'この30日' }, { value: '90', label: '過去90日' }, { value: 'all', label: 'すべての期間' },
]
const PAGE_SIZE_OPTIONS = [
  { value: '20', label: '20件表示' }, { value: '50', label: '50件表示' }, { value: '100', label: '100件表示' },
]
const SORT_OPTIONS = [
  { value: 'new', label: '記録が新しい順' }, { value: 'old', label: '記録が古い順' },
]

function isHealthy(row: Row): boolean { return row.result === 'ok' || row.result === 'success' }
function actionLabel(row: Row): string { return row.action === 'login' && !isHealthy(row) ? 'ログインに失敗しました' : ACTIONS[row.action] ?? '操作名を取得できませんでした' }

function belongsTo(row: Row, filter: string): boolean {
  if (filter === 'all') return true
  if (filter === 'deleted') return row.action === 'delete'
  if (filter === 'sent') return row.action === 'broadcast_sent' || row.action.includes('send')
  if (filter === 'settings') return row.action === 'settings_changed' || row.action.includes('update')
  if (filter === 'login') return row.action === 'login' || row.action === 'logout' || row.action === 'fail'
  if (filter === 'attention') return row.action === 'fail' || !isHealthy(row)
  return true
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日時を取得できませんでした'
  return date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function LoginAudit({ userId }: { userId?: string }) {
  const [rows, setRows] = useState<Row[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [query, setQuery] = useState(''), [actionFilter, setActionFilter] = useState('all'), [periodFilter, setPeriodFilter] = useState('30'), [sort, setSort] = useState('new')
  const [pageSize, setPageSize] = useState(20), [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { const res = await api.loginAudit.list({ userId, limit: 200 }); if (res.success) setRows(res.data) }
    catch { setError('入った記録を読み込めませんでした。時間をおいて、もう一度お試しください。') }
    finally { setLoading(false) }
  }, [userId])
  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => ({
    all: rows.length,
    deleted: rows.filter((row) => belongsTo(row, 'deleted')).length,
    sent: rows.filter((row) => belongsTo(row, 'sent')).length,
    settings: rows.filter((row) => belongsTo(row, 'settings')).length,
    login: rows.filter((row) => belongsTo(row, 'login')).length,
    attention: rows.filter((row) => belongsTo(row, 'attention')).length,
  }), [rows])
  const shown = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const periodStart = periodFilter === 'all' ? null : Date.now() - Number(periodFilter) * 24 * 60 * 60 * 1000
    return rows.filter((row) => {
      if (!belongsTo(row, actionFilter)) return false
      if (periodStart !== null && new Date(row.createdAt).getTime() < periodStart) return false
      return `${row.userName} ${actionLabel(row)} ${row.screen ?? ''}`.toLowerCase().includes(normalizedQuery)
    }).sort((a, b) => sort === 'new' ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [actionFilter, periodFilter, query, rows, sort])
  useEffect(() => { setPage(1) }, [actionFilter, pageSize, periodFilter, query, sort])
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize)), currentPage = Math.min(page, pageCount)
  const visible = shown.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const first = shown.length === 0 ? 0 : (currentPage - 1) * pageSize + 1, last = Math.min(currentPage * pageSize, shown.length)

  return <div id="staff-audit">
    <div data-design="KPIs" className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <AuditKpi label="この30日の記録" value={rows.length === 200 ? '200+' : rows.length.toLocaleString()} note="APIから取得できた範囲" />
      <AuditKpi label="消した操作" value={counts.deleted.toLocaleString()} note="削除として記録された操作" />
      <AuditKpi label="配信した操作" value={counts.sent.toLocaleString()} note="配信として記録された操作" />
      <AuditKpi label="いつもと違う場所から" value={counts.attention.toLocaleString()} note="失敗・拒否された記録" attention={counts.attention > 0} />
    </div>
    <div className="mb-4 rounded-control bg-info-bg px-4 py-3 text-sm font-medium text-accent">だれが、いつ、何をしたかの記録です。失敗・拒否された操作は赤く出します。場所の異常判定、対象の詳細、変更前後は監査APIの接続後に表示します。</div>
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="人の名前・操作の内容で検索" className="min-w-64 flex-1 rounded-control border border-hairline px-3 py-2 text-sm outline-none focus:border-accent" />
      <Select aria-label="期間で絞り込む" value={periodFilter} onChange={setPeriodFilter} options={PERIOD_OPTIONS} />
      <Select aria-label="表示件数" value={String(pageSize)} onChange={(value) => setPageSize(Number(value))} options={PAGE_SIZE_OPTIONS} />
    </div>
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <Tabs items={[
        { label: 'すべて', count: counts.all, current: actionFilter === 'all', onClick: () => setActionFilter('all') },
        { label: '消した', count: counts.deleted, current: actionFilter === 'deleted', onClick: () => setActionFilter('deleted') },
        { label: '配信した', count: counts.sent, current: actionFilter === 'sent', onClick: () => setActionFilter('sent') },
        { label: '設定を変えた', count: counts.settings, current: actionFilter === 'settings', onClick: () => setActionFilter('settings') },
        { label: 'ログイン', count: counts.login, current: actionFilter === 'login', onClick: () => setActionFilter('login') },
        { label: '気になるもの', count: counts.attention, current: actionFilter === 'attention', onClick: () => setActionFilter('attention') },
      ]} />
      <Select aria-label="並び順" value={sort} onChange={setSort} options={SORT_OPTIONS} />
    </div>
    {error ? <div className="rounded-card border border-danger bg-danger-bg p-8 text-center"><p className="mb-4 font-semibold text-danger">{error}</p><Button onClick={() => void load()}>もう一度読み込む</Button></div> : <div className="overflow-hidden rounded-card border border-hairline bg-canvas"><table className="w-full table-fixed text-sm"><thead><TableHeadRow><Th className="w-1/4">いつ・だれが</Th><Th className="w-1/5">何をしたか</Th><Th className="w-1/5">対象</Th><Th className="w-1/5">元の値 → 新しい値</Th><Th>場所</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">{loading ? <tr><td colSpan={5} className="p-8 text-center text-ink-faint">記録を読み込んでいます…</td></tr> : visible.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-ink-faint">条件に合う記録はありません。条件を変えてお試しください。</td></tr> : visible.map((row) => <tr key={row.id} className="hover:bg-canvas-sunken"><td className="px-3 py-3"><p className="truncate font-semibold text-ink" title={`${formatDate(row.createdAt)} ／ ${row.userName}`}>{formatDate(row.createdAt)} ／ {row.userName}</p><p className="mt-1 text-xs text-ink-faint">{row.role ? ROLES[row.role] : '権限を取得できませんでした'}</p></td><td className={`truncate px-3 py-3 font-medium ${belongsTo(row, 'attention') ? 'text-danger' : 'text-ink'}`} title={actionLabel(row)}>{actionLabel(row)}</td><td className="truncate px-3 py-3 text-ink-secondary" title={row.screen ?? '—'}>{row.screen ?? '—'}</td><td className="px-3 py-3 text-ink-faint">—（未取得）</td><td className={`truncate px-3 py-3 ${belongsTo(row, 'attention') ? 'text-danger' : 'text-ink-secondary'}`} title={row.connectionSource ?? row.ip ?? '—'}>{row.connectionSource ?? row.ip ?? '—'}</td></tr>)}</tbody></table></div>}
    {!loading && !error && shown.length > 0 && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-faint"><p>記録 {shown.length.toLocaleString()}件中 {first}〜{last}件を表示</p>{pageCount > 1 && <nav aria-label="入った記録のページ送り" className="flex items-center gap-2"><AuditPageLink disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>前へ</AuditPageLink><span className="font-semibold text-ink">{currentPage} / {pageCount}</span><AuditPageLink disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>次へ</AuditPageLink></nav>}</div>}
  </div>
}

function AuditKpi({ label, value, note, attention = false }: { label: string; value: string; note: string; attention?: boolean }) { return <div className="flex h-28 flex-col gap-1 rounded-card border border-hairline bg-canvas p-4"><p className="text-xs font-semibold leading-normal text-ink-faint">{label}</p><p className={`text-xl font-bold leading-normal tabular-nums ${attention ? 'text-danger' : 'text-ink'}`}>{value}<span className="ml-1 text-xs font-medium text-ink-faint">件</span></p><p className="text-xs leading-normal text-ink-faint">{note}</p></div> }

function AuditPageLink({ children, disabled, onClick }: { children: React.ReactNode; disabled: boolean; onClick: () => void }) { return <Button disabled={disabled} onClick={onClick}>{children}</Button> }
