'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Select from '@/components/shared/select'
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
const ACTIONS: Record<string, string> = { login: 'ログイン', logout: 'ログアウト', fail: 'ログイン失敗', view_personal: '個人情報を表示', export: 'CSVを書き出し' }
const ROLES: Record<string, string> = { admin: '管理者', staff: 'スタッフ', viewer: '閲覧のみ' }
const ACTION_OPTIONS = [
  { value: 'all', label: 'すべての履歴' },
  ...Object.entries(ACTIONS).map(([value, label]) => ({ value, label })),
]
const PERIOD_OPTIONS = [
  { value: '30', label: '過去30日' },
  { value: '90', label: '過去90日' },
  { value: 'all', label: 'すべての期間' },
]

export default function LoginAudit({ userId }: { userId?: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [periodFilter, setPeriodFilter] = useState('30')
  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.loginAudit.list({ userId, limit: 200 })
    if (res.success) setRows(res.data)
    setLoading(false)
  }, [userId])
  useEffect(() => { void load() }, [load])
  const shown = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const periodStart = periodFilter === 'all'
      ? null
      : Date.now() - Number(periodFilter) * 24 * 60 * 60 * 1000

    return rows.filter((row) => {
      if (actionFilter !== 'all' && row.action !== actionFilter) return false
      if (periodStart !== null && new Date(row.createdAt).getTime() < periodStart) return false
      return `${row.userName} ${ACTIONS[row.action] ?? row.action} ${row.screen ?? ''}`
        .toLowerCase()
        .includes(normalizedQuery)
    })
  }, [actionFilter, periodFilter, query, rows])
  const loginRows = rows.filter((r) => r.action === 'login')

  return <>
    <div className="mb-4 grid gap-4 md:grid-cols-3">
      <div className="bg-canvas rounded-card border-hairline border p-4"><p className="text-sm text-ink-secondary">過去30日の操作</p><p className="mt-2 text-3xl font-bold text-ink">{rows.length}<span className="ml-1 text-sm font-normal text-ink-faint">件</span></p></div>
      <div className="bg-canvas rounded-card border-hairline border p-4"><p className="text-sm text-ink-secondary">直近のログイン</p><p className="mt-2 text-lg font-bold text-ink">{loginRows[0]?.createdAt?.replace('T', ' ').slice(0, 16) ?? '—'}</p></div>
      <div className="bg-canvas rounded-card border-hairline border p-4"><p className="text-sm text-ink-secondary">無効の操作</p><p className="mt-2 text-3xl font-bold text-ink">{rows.filter((r) => !r.isActive || r.result !== 'ok').length}<span className="ml-1 text-sm font-normal text-ink-faint">件</span></p></div>
    </div>
    <div className="bg-canvas rounded-card border-hairline border">
      <div className="border-hairline flex flex-wrap gap-3 border-b p-4">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="履歴を検索" className="border-hairline rounded-control min-w-64 flex-1 border px-3 py-2 text-sm outline-none focus:border-accent" />
        <Select aria-label="操作内容で絞り込む" value={actionFilter} onChange={setActionFilter} options={ACTION_OPTIONS} />
        <Select aria-label="期間で絞り込む" value={periodFilter} onChange={setPeriodFilter} options={PERIOD_OPTIONS} />
      </div>
      <div><table className="w-full table-fixed text-sm"><thead><TableHeadRow><Th className="w-1/6">操作日時</Th><Th className="w-1/6">操作内容</Th><Th className="w-1/6">操作画面</Th><Th className="w-1/6">ユーザー</Th><Th>権限</Th><Th>LINE連携</Th><Th className="w-1/6">接続元</Th><Th>状況</Th></TableHeadRow></thead>
      <tbody className="divide-hairline divide-y">{loading ? <tr><td colSpan={8} className="p-8 text-center text-ink-faint">読み込み中…</td></tr> : shown.length === 0 ? <tr><td colSpan={8} className="p-8 text-center text-ink-faint">条件に合う記録はありません。</td></tr> : shown.map((r) => <tr key={r.id} className="hover:bg-canvas-sunken"><td className="whitespace-nowrap px-3 py-3 tabular-nums text-ink-secondary">{r.createdAt.replace('T', ' ').slice(0, 19)}</td><td className="truncate px-3 py-3 font-medium text-ink" title={ACTIONS[r.action] ?? r.action}>{ACTIONS[r.action] ?? r.action}</td><td className="truncate px-3 py-3 text-ink-secondary" title={r.screen ?? 'ログイン画面'}>{r.screen ?? 'ログイン画面'}</td><td className="truncate px-3 py-3 text-ink" title={r.userName}>{r.userName}</td><td className="px-3 py-3 text-ink-secondary">{r.role ? ROLES[r.role] : '—'}</td><td className="px-3 py-3 text-ink-secondary">{r.lineLinked ? '連携済み' : '未連携'}</td><td className="truncate px-3 py-3 text-xs text-ink-faint" title={r.connectionSource ?? ''}>{r.connectionSource ?? '—'}</td><td className="px-3 py-3"><span className={`whitespace-nowrap rounded-pill px-2 py-1 text-xs font-medium ${r.isActive && r.result === 'ok' ? 'bg-accent-soft text-success' : 'bg-danger-bg text-danger'}`}>{r.isActive && r.result === 'ok' ? '有効' : '無効'}</span></td></tr>)}</tbody></table></div>
    </div>
  </>
}
