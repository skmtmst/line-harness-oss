'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

export default function LoginAudit({ userId }: { userId?: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.loginAudit.list({ userId, limit: 200 })
    if (res.success) setRows(res.data)
    setLoading(false)
  }, [userId])
  useEffect(() => { void load() }, [load])
  const shown = useMemo(() => rows.filter((r) => `${r.userName} ${ACTIONS[r.action] ?? r.action} ${r.screen ?? ''}`.toLowerCase().includes(query.toLowerCase())), [rows, query])
  const loginRows = rows.filter((r) => r.action === 'login')

  return <>
    <div className="mb-4 grid gap-4 md:grid-cols-3">
      <div className="bg-canvas rounded-card border-hairline border p-4"><p className="text-sm text-ink-secondary">過去30日の操作</p><p className="mt-2 text-3xl font-bold text-ink">{rows.length}<span className="ml-1 text-sm font-normal text-ink-faint">件</span></p></div>
      <div className="bg-canvas rounded-card border-hairline border p-4"><p className="text-sm text-ink-secondary">直近のログイン</p><p className="mt-2 text-lg font-bold text-ink">{loginRows[0]?.createdAt?.replace('T', ' ').slice(0, 16) ?? '—'}</p></div>
      <div className="bg-canvas rounded-card border-hairline border p-4"><p className="text-sm text-ink-secondary">無効の操作</p><p className="mt-2 text-3xl font-bold text-ink">{rows.filter((r) => !r.isActive || r.result !== 'ok').length}<span className="ml-1 text-sm font-normal text-ink-faint">件</span></p></div>
    </div>
    <div className="bg-canvas rounded-card border-hairline border">
      <div className="border-hairline flex flex-wrap gap-3 border-b p-4"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="履歴を検索" className="border-hairline rounded-control min-w-64 flex-1 border px-3 py-2 text-sm outline-none focus:border-accent" /><select className="rounded-control border border-hairline bg-canvas px-3 text-sm text-ink-secondary"><option>すべての履歴</option></select><select className="rounded-control border border-hairline bg-canvas px-3 text-sm text-ink-secondary"><option>過去30日</option></select></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-sm"><thead><tr className="bg-canvas-sunken border-hairline border-b text-left text-xs text-ink-faint"><th className="px-4 py-3">操作日時</th><th className="px-4 py-3">操作内容</th><th className="px-4 py-3">操作画面</th><th className="px-4 py-3">ユーザー</th><th className="px-4 py-3">権限</th><th className="px-4 py-3">LINE連携</th><th className="px-4 py-3">接続元</th><th className="px-4 py-3">状況</th></tr></thead>
      <tbody className="divide-hairline divide-y">{loading ? <tr><td colSpan={8} className="p-8 text-center text-ink-faint">読み込み中...</td></tr> : shown.length === 0 ? <tr><td colSpan={8} className="p-8 text-center text-ink-faint">記録がありません。</td></tr> : shown.map((r) => <tr key={r.id} className="hover:bg-canvas-sunken"><td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-secondary">{r.createdAt.replace('T', ' ').slice(0, 19)}</td><td className="px-4 py-3 font-medium text-ink">{ACTIONS[r.action] ?? r.action}</td><td className="px-4 py-3 text-ink-secondary">{r.screen ?? 'ログイン画面'}</td><td className="px-4 py-3 text-ink">{r.userName}</td><td className="px-4 py-3 text-ink-secondary">{r.role ? ROLES[r.role] : '—'}</td><td className="px-4 py-3 text-ink-secondary">{r.lineLinked ? '連携済み' : '未連携'}</td><td className="max-w-64 truncate px-4 py-3 text-xs text-ink-faint" title={r.connectionSource ?? ''}>{r.connectionSource ?? '—'}</td><td className="px-4 py-3"><span className={`rounded-pill px-2 py-1 text-xs font-medium ${r.isActive && r.result === 'ok' ? 'bg-accent-bg text-success' : 'bg-danger-bg text-danger'}`}>{r.isActive && r.result === 'ok' ? '有効' : '無効'}</span></td></tr>)}</tbody></table></div>
    </div>
  </>
}
