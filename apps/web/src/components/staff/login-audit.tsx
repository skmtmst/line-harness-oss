'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/components/shared/button'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import { Tabs } from '@/components/shared/tabs'
import { TableHeadRow, Th } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import { api, type AuditEventItem, type AuditEventSummary } from '@/lib/api'

const EMPTY_SUMMARY: AuditEventSummary = {
  periodDays: 30,
  total: 0,
  deleted: 0,
  sent: 0,
  changed: 0,
  logins: 0,
  suspiciousLogins: 0,
}

const ROLE_LABELS: Record<string, string> = {
  owner: '管理者',
  admin: '管理者',
  staff: '運用',
  viewer: '見るだけ',
}

const PERIOD_OPTIONS = [
  { value: '30', label: 'この30日' },
  { value: '90', label: '過去90日' },
  { value: 'all', label: 'すべての期間' },
]

const PAGE_SIZE_OPTIONS = [
  { value: '20', label: '20件表示' },
  { value: '50', label: '50件表示' },
  { value: '100', label: '100件表示' },
]

const SORT_OPTIONS = [
  { value: 'new', label: '記録が新しい順' },
  { value: 'old', label: '記録が古い順' },
]

function isAttention(row: AuditEventItem): boolean {
  return row.riskLevel !== 'normal' || row.result !== 'success'
}

function belongsTo(row: AuditEventItem, filter: string): boolean {
  const action = row.action.toLowerCase()
  if (filter === 'all') return true
  if (filter === 'deleted') return action.includes('delete')
  if (filter === 'sent') return action.includes('send') || action.includes('publish')
  if (filter === 'settings') return action.includes('update') || action.includes('change') || action.includes('patch') || action.includes('put')
  if (filter === 'login') return row.category === 'auth' && action.includes('login')
  if (filter === 'attention') return isAttention(row)
  return true
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日時を取得できませんでした'
  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function actionLabel(row: AuditEventItem): string {
  const action = row.action.toLowerCase()
  if (action === 'auth.login') return row.result === 'success' ? 'ログインしました' : 'ログインに失敗しました'
  if (action === 'auth.logout') return 'ログアウトしました'
  if (action.includes('delete')) return '削除しました'
  if (action.includes('send') || action.includes('publish')) return '配信しました'
  if (action.includes('suspend')) return '利用を停止しました'
  if (action.includes('update') || action.includes('change') || action.includes('patch') || action.includes('put')) return '設定を変えました'
  return row.category === 'auth' ? '認証を確認しました' : '操作しました'
}

function targetLabel(row: AuditEventItem): string {
  if (!row.target) return '—'
  return [row.target.kind, row.target.id].filter(Boolean).join(' ／ ') || '—'
}

function objectValue(value: Record<string, unknown> | null): string {
  if (!value) return '—'
  const parts = Object.values(value).flatMap((item) => {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return [String(item)]
    return []
  })
  return parts.length > 0 ? parts.slice(0, 2).join('・') : '変更内容あり'
}

function changeLabel(row: AuditEventItem): string {
  if (!row.before && !row.after) return '—'
  return `${objectValue(row.before)} → ${objectValue(row.after)}`
}

function locationLabel(row: AuditEventItem): string {
  const source = [row.ipPrefix, row.deviceFamily].filter(Boolean).join(' ／ ')
  const region = row.regionLabel ?? '—'
  if (row.riskLevel === 'normal') return `${region}${source ? ` ／ ${source}` : ''}（いつもの場所）`
  return `${region}${source ? ` ／ ${source}` : ''}（要確認）`
}

export default function LoginAudit({ userId }: { userId?: string }) {
  const { selectedAccountId } = useAccount()
  const [rows, setRows] = useState<AuditEventItem[]>([])
  const [summary, setSummary] = useState<AuditEventSummary>(EMPTY_SUMMARY)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [periodFilter, setPeriodFilter] = useState('30')
  const [sort, setSort] = useState('new')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<AuditEventItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const from = periodFilter === 'all'
        ? undefined
        : new Date(Date.now() - Number(periodFilter) * 24 * 60 * 60 * 1000).toISOString()
      const category = actionFilter === 'login' ? 'auth' as const : undefined
      const resultFilter = actionFilter === 'attention' ? 'failed' as const : undefined
      const action = actionFilter === 'deleted'
        ? 'delete'
        : actionFilter === 'sent'
          ? 'send'
          : actionFilter === 'settings'
            ? 'update'
            : undefined
      const auditResult = await api.audit.events({
        lineAccountId: selectedAccountId ?? undefined,
        actorId: userId,
        query: query.trim() || undefined,
        from,
        category,
        result: resultFilter,
        action,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      if (auditResult.success) {
        setRows(auditResult.data.items)
        setSummary(auditResult.data.summary)
        setTotal(auditResult.data.pagination.total)
      }
    } catch {
      setError('入った記録を読み込めませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [actionFilter, page, pageSize, periodFilter, query, selectedAccountId, userId])

  useEffect(() => { void load() }, [load])

  const counts = {
    all: summary.total,
    deleted: summary.deleted,
    sent: summary.sent,
    settings: summary.changed,
    login: summary.logins,
    attention: summary.suspiciousLogins,
  }
  const shown = useMemo(() => rows
    .filter((row) => belongsTo(row, actionFilter))
    .sort((a, b) => sort === 'new'
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [actionFilter, rows, sort])
  useEffect(() => { setPage(1) }, [actionFilter, pageSize, periodFilter, query, sort])
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visible = shown
  const first = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const last = visible.length === 0 ? 0 : Math.min(first + visible.length - 1, total)

  return <div id="staff-audit">
    <div data-design="KPIs" className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <AuditKpi label="この30日の記録" value={summary.total} note="認証と業務操作をまとめて集計" />
      <AuditKpi label="消した操作" value={summary.deleted} note="削除として記録された操作" />
      <AuditKpi label="配信した操作" value={summary.sent} note="送信・公開として記録された操作" />
      <AuditKpi label="いつもと違う場所から" value={summary.suspiciousLogins} note="見なれない場所からのログイン" attention={summary.suspiciousLogins > 0} />
    </div>
    <div className="mb-4 rounded-control bg-info-bg px-4 py-3 text-sm font-medium text-accent">だれが、いつ、何をしたかの記録です。いつもと違う場所からのログインは赤く出します。消した・配信した・設定を変えたで絞れます。</div>
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <SearchField value={query} onChange={setQuery} placeholder="人の名前・操作の内容で検索" className="min-w-64 flex-1" />
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
    {error
      ? <div className="rounded-card border border-danger bg-danger-bg p-8 text-center"><p className="mb-4 font-semibold text-danger">{error}</p><Button onClick={() => void load()}>もう一度読み込む</Button></div>
      : <div className="overflow-hidden rounded-card border border-hairline bg-canvas"><table className="w-full table-fixed text-sm"><thead><TableHeadRow><Th className="w-1/4">いつ・だれが</Th><Th className="w-1/5">何をしたか</Th><Th className="w-1/5">対象</Th><Th className="w-1/5">元の値 → 新しい値</Th><Th>場所</Th><Th align="right">操作</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">{loading
        ? <tr><td colSpan={6} className="p-8 text-center text-ink-faint">記録を読み込んでいます…</td></tr>
        : visible.length === 0
          ? <tr><td colSpan={6} className="p-8 text-center text-ink-faint">条件に合う記録はありません。条件を変えてお試しください。</td></tr>
          : visible.map((row) => <tr key={row.id} className="hover:bg-canvas-sunken"><td className="px-3 py-3"><p className="truncate font-semibold text-ink" title={`${formatDate(row.createdAt)} ／ ${row.actor.name ?? '名前未取得'}`}>{formatDate(row.createdAt)} ／ {row.actor.name ?? '名前未取得'}</p><p className="mt-1 text-xs text-ink-faint">{row.actor.role ? ROLE_LABELS[row.actor.role] ?? row.actor.role : '権限を取得できませんでした'}</p></td><td className={`truncate px-3 py-3 font-medium ${isAttention(row) ? 'text-danger' : 'text-ink'}`} title={actionLabel(row)}>{actionLabel(row)}</td><td className="truncate px-3 py-3 text-ink-secondary" title={targetLabel(row)}>{targetLabel(row)}</td><td className="truncate px-3 py-3 text-ink-secondary" title={changeLabel(row)}>{changeLabel(row)}</td><td className={`truncate px-3 py-3 ${isAttention(row) ? 'text-danger' : 'text-ink-secondary'}`} title={locationLabel(row)}>{locationLabel(row)}</td><td className="px-3 py-3 text-right"><Button variant="secondary" onClick={() => setDetail(row)}>詳細を見る</Button></td></tr>)}</tbody></table></div>}
    {!loading && !error && total > 0 && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-faint"><p>記録 {total.toLocaleString()}件中 {first}〜{last}件を表示</p>{pageCount > 1 && <nav aria-label="入った記録のページ送り" className="flex items-center gap-2"><AuditPageLink disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>前へ</AuditPageLink><span className="font-semibold text-ink">{currentPage} / {pageCount}</span><AuditPageLink disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>次へ</AuditPageLink></nav>}</div>}
    {detail && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true"><div className="max-h-screen w-full max-w-xl overflow-y-auto rounded-card bg-canvas p-6 shadow-xl"><div className="flex items-start justify-between"><div><h2 className="text-lg font-bold text-ink">操作記録の詳細</h2><p className="mt-1 text-xs text-ink-secondary">{formatDate(detail.createdAt)} ／ {detail.actor.name ?? '名前未取得'}</p></div><Button variant="secondary" onClick={() => setDetail(null)}>閉じる</Button></div><dl className="mt-5 grid gap-3 text-sm"><div><dt className="text-xs text-ink-faint">対象</dt><dd className="mt-1 text-ink">{targetLabel(detail)}</dd></div><div><dt className="text-xs text-ink-faint">変更前 → 変更後</dt><dd className="mt-1 text-ink">{changeLabel(detail)}</dd></div><div><dt className="text-xs text-ink-faint">場所</dt><dd className="mt-1 text-ink">{locationLabel(detail)}</dd></div></dl></div></div>}
  </div>
}

function AuditKpi({ label, value, note, attention = false }: { label: string; value: number; note: string; attention?: boolean }) {
  return <div className="flex h-28 flex-col gap-1 rounded-card border border-hairline bg-canvas p-4"><p className="text-xs font-semibold leading-normal text-ink-faint">{label}</p><p className={`text-xl font-bold leading-normal tabular-nums ${attention ? 'text-danger' : 'text-ink'}`}>{value.toLocaleString()}<span className="ml-1 text-xs font-medium text-ink-faint">件</span></p><p className="text-xs leading-normal text-ink-faint">{note}</p></div>
}

function AuditPageLink({ children, disabled, onClick }: { children: React.ReactNode; disabled: boolean; onClick: () => void }) {
  return <Button disabled={disabled} onClick={onClick}>{children}</Button>
}
