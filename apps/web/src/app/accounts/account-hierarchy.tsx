'use client'

import { useEffect, useMemo, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'

type AccountItem = LineAccount & { displayName?: string; basicId?: string | null }

export default function AccountHierarchy() {
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    const response = await api.lineAccounts.list()
    if (response.success) setAccounts(response.data as AccountItem[])
    else setError(response.error)
  }
  useEffect(() => { void load() }, [])

  const childrenByParent = useMemo(() => {
    const map = new Map<string, AccountItem[]>()
    for (const account of accounts) {
      if (!account.parentLineAccountId) continue
      map.set(account.parentLineAccountId, [...(map.get(account.parentLineAccountId) ?? []), account])
    }
    return map
  }, [accounts])
  const roots = accounts.filter((account) => !account.parentLineAccountId)
  const unassigned = roots.filter((account) => !(childrenByParent.get(account.id)?.length))
  const hierarchyRoots = roots.filter((account) => childrenByParent.get(account.id)?.length)

  const move = async (parentLineAccountId: string | null) => {
    if (!draggedId || draggedId === parentLineAccountId || saving) return
    setSaving(true)
    setError('')
    const response = await api.lineAccounts.updateHierarchy([
      { id: draggedId, parentLineAccountId },
    ])
    if (response.success) await load()
    else setError(response.error)
    setDraggedId(null)
    setSaving(false)
  }

  const card = (account: AccountItem, depth: number): React.ReactNode => (
    <div key={account.id} className={depth ? 'ml-8 border-l border-hairline pl-5' : ''}>
      <div
        draggable={!saving}
        onDragStart={() => setDraggedId(account.id)}
        onDragEnd={() => setDraggedId(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); void move(account.id) }}
        className={`mb-2 flex min-h-14 items-center justify-between rounded-card border bg-canvas px-4 py-3 transition-colors ${draggedId === account.id ? 'border-accent opacity-50' : 'border-hairline hover:border-accent'}`}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{account.displayName || account.name}</p>
          <p className="mt-0.5 truncate text-xs text-ink-faint">
            {depth === 0 ? '親' : depth === 1 ? '子' : '孫'}
            {account.basicId ? ` ・ ${account.basicId}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-pill px-2 py-1 text-xs ${account.isActive ? 'bg-accent-soft text-accent' : 'bg-canvas-sunken text-ink-faint'}`}>
            {account.isActive ? '接続済み' : '停止中'}
          </span>
          <span className="cursor-grab text-ink-faint" aria-label="ドラッグして移動">⋮⋮</span>
        </div>
      </div>
      {(childrenByParent.get(account.id) ?? []).map((child) => card(child, depth + 1))}
    </div>
  )

  return (
    <div className="space-y-5 py-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink">LINEアカウント構成</h1>
          <p className="mt-1 text-sm text-ink-secondary">LINE公式アカウントをドラッグして、親・子・孫の3階層まで紐づけます。</p>
        </div>
        {saving && <span className="text-xs text-ink-faint">保存中...</span>}
      </div>

      {error && <div className="rounded-control border border-danger bg-danger-bg px-4 py-3 text-sm text-danger">{error}</div>}

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <section className="rounded-card border border-hairline bg-canvas p-4">
          <h2 className="text-sm font-semibold text-ink">未設定のアカウント</h2>
          <p className="mt-1 text-xs text-ink-faint">構成にまだ紐づいていないLINE公式アカウントです。</p>
          <div className="mt-4 space-y-2">
            {unassigned.length === 0 ? (
              <p className="rounded-control bg-canvas-sunken px-3 py-4 text-center text-xs text-ink-faint">未設定はありません</p>
            ) : unassigned.map((account) => (
              <div
                key={account.id}
                draggable={!saving}
                onDragStart={() => setDraggedId(account.id)}
                onDragEnd={() => setDraggedId(null)}
                className="cursor-grab rounded-control border border-hairline px-3 py-3"
              >
                <p className="truncate text-sm font-medium text-ink">{account.displayName || account.name}</p>
                <p className="mt-1 text-xs text-ink-faint">{account.isActive ? '接続済み' : '停止中'}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="min-h-80 rounded-card border border-hairline bg-canvas p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">アカウント構成</h2>
            <span className="text-xs text-ink-faint">上位アカウントは下位アカウントを管理できます</span>
          </div>
          <div className="mt-4">
            {hierarchyRoots.length === 0 ? (
              <div className="rounded-card border border-dashed border-hairline px-5 py-12 text-center text-sm text-ink-faint">
                左のアカウントを別のアカウントへドロップすると構成を作成できます。
              </div>
            ) : hierarchyRoots.map((account) => card(account, 0))}
          </div>
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); void move(null) }}
            className="mt-4 rounded-control border border-dashed border-hairline px-4 py-3 text-center text-xs text-ink-faint"
          >
            ここへドロップして親子関係を解除
          </div>
        </section>
      </div>
    </div>
  )
}
