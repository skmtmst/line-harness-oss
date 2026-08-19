'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'

type AccountItem = LineAccount & { displayName?: string; basicId?: string | null }

export default function AccountHierarchy({ tabs }: { tabs?: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [savedParents, setSavedParents] = useState(new Map<string, string | null>())
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    const response = await api.lineAccounts.list()
    if (response.success) {
      const items = response.data as AccountItem[]
      setAccounts(items)
      setSavedParents(new Map(items.map((item) => [item.id, item.parentLineAccountId ?? null])))
      setError('')
    } else setError(response.error)
    setLoading(false)
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
  const changed = accounts.filter((account) => savedParents.get(account.id) !== (account.parentLineAccountId ?? null))

  const place = (parentLineAccountId: string | null) => {
    if (!draggedId || draggedId === parentLineAccountId || saving) return
    const parent = parentLineAccountId ? accounts.find((item) => item.id === parentLineAccountId) : null
    const ancestorIds = new Set<string>()
    let cursor = parent
    let depth = 1
    while (cursor) {
      if (cursor.id === draggedId || ancestorIds.has(cursor.id)) {
        setError('アカウント構成を循環させることはできません')
        return
      }
      ancestorIds.add(cursor.id)
      cursor = cursor.parentLineAccountId ? accounts.find((item) => item.id === cursor?.parentLineAccountId) : undefined
      depth += 1
    }
    if (parent && depth > 3) {
      setError('アカウント構成は親・子・孫の3階層までです')
      return
    }
    setAccounts((items) => items.map((item) => item.id === draggedId ? { ...item, parentLineAccountId } : item))
    setDraggedId(null)
    setError('')
  }

  const save = async () => {
    if (changed.length === 0 || saving) return
    setSaving(true)
    setError('')
    const response = await api.lineAccounts.updateHierarchy(
      changed.map((item) => ({ id: item.id, parentLineAccountId: item.parentLineAccountId ?? null })),
    )
    if (response.success) await load()
    else setError(response.error)
    setSaving(false)
  }

  const cancelChanges = () => {
    setAccounts((items) => items.map((item) => ({ ...item, parentLineAccountId: savedParents.get(item.id) ?? null })))
    setError('')
  }

  const node = (account: AccountItem, depth: number): ReactNode => {
    const children = childrenByParent.get(account.id) ?? []
    const depthLabel = depth === 0 ? '親' : depth === 1 ? '子' : '孫'
    return <div key={account.id} className={depth > 0 ? 'ml-8' : ''}>
      <div
        draggable={!saving}
        onDragStart={() => setDraggedId(account.id)}
        onDragEnd={() => setDraggedId(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); place(account.id) }}
        className={`mb-2 flex min-h-14 cursor-grab items-center gap-3 rounded-control border px-4 py-3 transition-colors ${depth === 0 ? 'border-accent bg-accent-soft' : depth === 1 ? 'border-info bg-info-bg' : 'border-hairline bg-canvas'} ${draggedId === account.id ? 'opacity-45' : ''}`}
      >
        <span className="text-ink-faint">⠇</span><span className={`flex h-7 w-7 items-center justify-center rounded-control text-sm ${depth === 0 ? 'bg-canvas text-success' : depth === 1 ? 'bg-canvas text-accent' : 'bg-accent-soft text-success'}`}>▧</span>
        <div className="min-w-0 flex-1"><p className="truncate whitespace-nowrap text-sm font-semibold text-ink" title={account.displayName || account.name}>{account.displayName || account.name}</p><p className="truncate whitespace-nowrap text-[11px] text-ink-faint">{account.basicId || (depth === 0 ? '親・LINE公式アカウント' : `上位LINEの${depthLabel}`)}</p></div>
        {depth === 0 && <span className="text-[10px] text-ink-faint">ログイン時の表示<br/><b className="text-success">権限ON：子・孫のLINEを表示</b></span>}
        {depth > 0 && <><span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] ${depth === 1 ? 'bg-canvas text-accent' : 'bg-accent-soft text-success'}`}>{depthLabel}</span><span className={`whitespace-nowrap text-[10px] font-medium ${depth === 1 ? 'text-accent' : 'text-ink-faint'}`}>{depth === 1 ? '権限ON：孫を管理' : '自分のみ'}</span></>}
      </div>
      {children.map((child) => node(child, depth + 1))}
      {depth < 2 && <DropLine onDrop={() => place(account.id)} label={depth === 0 ? 'ここへLINEアカウントをドロップすると「子」になります' : 'ここへLINEアカウントをドロップすると「孫」になります'} />}
    </div>
  }

  return <div>
    <nav className="mb-4 text-xs text-ink-faint"><Link href="/accounts" className="font-medium text-accent hover:underline">アカウント</Link><span className="mx-2">/</span><span>LINEアカウント構成</span></nav>
    <Header
      title="LINEアカウント構成"
      description="登録済みのLINE公式アカウント同士を、親・子・孫の3階層まで紐付けます。"
      action={<div className="flex items-center gap-2"><Link href="/staff" className="whitespace-nowrap rounded-control border border-hairline bg-canvas px-4 py-2 text-sm font-medium text-ink">◇ 権限を設定</Link><Link href="/accounts/new" className="whitespace-nowrap rounded-control bg-accent px-4 py-2 text-sm font-medium text-on-accent">＋ LINEアカウントを追加</Link><button onClick={() => void save()} disabled={changed.length === 0 || saving} className="cursor-pointer whitespace-nowrap rounded-control bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:cursor-not-allowed disabled:bg-hairline">▣ {saving ? '保存中…' : '構成を保存'}</button></div>}
    />
    {tabs}
    <div className="mb-4 rounded-control border border-info bg-info-bg px-4 py-3 text-xs font-medium text-accent">⚓ 登録済みのLINEアカウントをドラッグ＆ドロップし、親・子・孫の3階層まで紐付けます。下位階層を表示・操作できるのは「他アカウント権限」がONの管理者だけです。</div>
    {error && <div className="mb-4 rounded-control border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</div>}
    <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <section className="rounded-card border border-warning bg-warning-bg p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-warning">▧ 未設定のLINEアカウント</h2><span className="rounded-pill bg-canvas px-2 py-1 text-xs font-semibold text-warning">{unassigned.length}件</span></div><p className="mt-2 text-[11px] leading-5 text-ink-secondary">まだ親・子・孫に紐づいていません。カードを中央へドラッグします。</p><div className="mt-3 space-y-2">{loading ? <p className="text-xs text-ink-faint">読み込み中…</p> : unassigned.length === 0 ? <p className="rounded-control bg-canvas px-3 py-4 text-center text-xs text-ink-faint">未設定はありません</p> : unassigned.map((account) => <div key={account.id} draggable={!saving} onDragStart={() => setDraggedId(account.id)} onDragEnd={() => setDraggedId(null)} className={`flex cursor-grab items-center gap-2 rounded-control border border-hairline bg-canvas px-3 py-3 ${draggedId === account.id ? 'opacity-45' : ''}`}><span className="text-ink-faint">⠇</span><span className="text-success">▧</span><div className="min-w-0"><p className="truncate whitespace-nowrap text-xs font-semibold">{account.displayName || account.name}</p><p className="text-[10px] text-ink-faint">階層未設定</p></div><span className="ml-auto text-[10px] font-semibold text-success">未設定</span></div>)}</div></section>
      <section className="rounded-card border border-hairline bg-canvas p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-ink">LINEアカウント階層をドラッグ＆ドロップで編集</h2><p className="mt-1 text-xs text-ink-faint">登録済みのLINE公式アカウントを移動して、親・子・孫を設定します。</p></div>{changed.length > 0 && <span className="rounded-pill bg-warning-bg px-3 py-1 text-xs font-semibold text-warning">◉ 未保存の変更 {changed.length}件</span>}</div><div className="mt-4">{loading ? <p className="py-12 text-center text-sm text-ink-faint">読み込み中…</p> : hierarchyRoots.length === 0 ? <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); place(null) }} className="rounded-control border border-dashed border-info bg-info-bg px-5 py-14 text-center text-sm text-accent">左のLINEアカウントをここへドロップして構成を作ります</div> : hierarchyRoots.map((account) => node(account, 0))}</div><DropLine onDrop={() => place(null)} label="親LINEの直下へドロップすると「親」になります" blue /><p className="mt-3 rounded-control bg-accent-soft px-4 py-3 text-xs font-medium text-success">◉ 親・子・孫はすべてLINE公式アカウントです。「他アカウント権限」がONのユーザーだけが、担当LINEより下の階層を表示・操作できます。</p>{changed.length > 0 && <div className="mt-4 flex justify-end gap-2"><button onClick={cancelChanges} className="rounded-control border border-hairline px-4 py-2 text-sm">変更を取り消す</button><button onClick={() => void save()} disabled={saving} className="rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent">▣ 構成を保存</button></div>}</section>
    </div>
  </div>
}

function DropLine({ onDrop, label, blue = false }: { onDrop: () => void; label: string; blue?: boolean }) {
  return <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop() }} className={`mb-2 rounded-control border border-dashed px-3 py-2 text-center text-[10px] font-medium ${blue ? 'border-info bg-info-bg text-accent' : 'border-accent/30 bg-accent-soft text-success'}`}>↓ {label}</div>
}
