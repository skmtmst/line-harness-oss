'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { LineAccount, StaffMember } from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'

const ROLE_LABEL = { owner: 'オーナー', admin: '管理者', staff: 'スタッフ', viewer: '閲覧のみ' } as const

export default function HqStaffSection() {
  const [members, setMembers] = useState<StaffMember[]>([])
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [me, setMe] = useState<StaffMember | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'staff' | 'viewer'>('staff')
  const [scope, setScope] = useState<'all' | 'accounts'>('accounts')
  const [scopeIds, setScopeIds] = useState<string[]>([])
  const [assignedId, setAssignedId] = useState('')
  const [editing, setEditing] = useState<StaffMember | null>(null)
  const [error, setError] = useState('')
  const accountNames = useMemo(() => new Map(accounts.map((account) => [account.id, account.name])), [accounts])

  const load = async () => {
    const [staffResponse, accountResponse, meResponse] = await Promise.all([api.staff.list(), api.lineAccounts.list(), api.staff.me()])
    if (staffResponse.success) setMembers(staffResponse.data)
    if (accountResponse.success) { setAccounts(accountResponse.data); setAssignedId((value) => value || accountResponse.data[0]?.id || '') }
    if (meResponse.success) setMe(meResponse.data)
  }
  useEffect(() => { void load().catch(() => setError('権限者を読み込めませんでした。')) }, [])

  const toggle = (id: string, current: string[], setter: (ids: string[]) => void) => setter(current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (scope === 'accounts' && scopeIds.length === 0) { setError('指定した店舗を1つ以上選んでください。'); return }
    try {
      const response = await api.staff.create({ name: name.trim(), email: email.trim(), role, assignedLineAccountId: assignedId, accountScope: scope, scopedLineAccountIds: scopeIds, managementContext: 'hq' })
      if (!response.success) throw new Error(response.error)
      setName(''); setEmail(''); setScopeIds([]); await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '権限者を追加できませんでした。') }
  }
  const saveScope = async () => {
    if (!editing) return
    if (editing.accountScope === 'accounts' && (editing.scopedLineAccountIds ?? []).length === 0) { setError('指定した店舗を1つ以上選んでください。'); return }
    const response = await api.staff.update(editing.id, { accountScope: editing.accountScope, scopedLineAccountIds: editing.scopedLineAccountIds, managementContext: 'hq' })
    if (!response.success) { setError(response.error); return }
    setEditing(null); await load()
  }
  const scopeLabel = (member: StaffMember) => member.accountScope !== 'accounts' ? '全店舗' : (member.scopedLineAccountIds ?? []).map((id) => accountNames.get(id) ?? '不明な店舗').join('、')

  if (me?.accountScope === 'accounts') return <section className="mt-8 rounded-card border border-hairline bg-canvas p-6"><h2 className="text-lg font-semibold">権限者</h2><p className="mt-2 text-sm text-ink-secondary">全店舗の担当者だけが利用できます。</p></section>
  return <section className="mt-8 space-y-5 rounded-card border border-hairline bg-canvas p-6 shadow-sm">
    <div><h2 className="text-lg font-semibold text-ink">権限者</h2><p className="mt-1 text-sm text-ink-secondary">統括にログインできる人と、担当する店舗を管理します。</p></div>
    {error && <p role="alert" className="rounded-control bg-danger-bg p-3 text-sm text-danger">{error}</p>}
    <div className="overflow-hidden rounded-card border border-hairline"><table className="w-full table-fixed text-sm"><thead className="bg-canvas-sunken text-left text-xs text-ink-faint"><tr><th className="p-3">名前</th><th className="p-3">メールアドレス</th><th className="p-3">役割</th><th className="p-3">担当範囲</th><th className="p-3">状態</th><th className="w-20 p-3">変更</th></tr></thead><tbody className="divide-y divide-hairline">{members.map((member) => <tr key={member.id}><td className="truncate p-3" title={member.name}>{member.name}</td><td className="truncate p-3" title={member.email ?? ''}>{member.email ?? '—'}</td><td className="p-3">{ROLE_LABEL[member.role]}</td><td className="truncate p-3" title={scopeLabel(member)}>{scopeLabel(member)}</td><td className="p-3">{member.isActive ? '有効' : member.inviteStatus === 'active' ? '無効' : '招待中'}</td><td className="p-3"><button type="button" className="text-accent" onClick={() => setEditing(member)}>変更</button></td></tr>)}</tbody></table></div>
    {editing && <div className="rounded-card border border-accent bg-accent-soft p-4"><p className="font-semibold">{editing.name}さんの担当範囲</p><ScopeFields scope={editing.accountScope ?? 'all'} ids={editing.scopedLineAccountIds ?? []} accounts={accounts} setScope={(value) => setEditing({ ...editing, accountScope: value, scopedLineAccountIds: value === 'all' ? [] : editing.scopedLineAccountIds })} toggle={(id) => toggle(id, editing.scopedLineAccountIds ?? [], (ids) => setEditing({ ...editing, scopedLineAccountIds: ids }))} /><div className="mt-3 flex gap-2"><Button type="button" variant="primary" onClick={() => void saveScope()}>保存</Button><Button type="button" variant="secondary" onClick={() => setEditing(null)}>閉じる</Button></div></div>}
    <form onSubmit={submit} className="space-y-4 border-t border-hairline pt-5"><h3 className="font-semibold">権限者を追加</h3><div className="grid gap-3 md:grid-cols-2"><label className="text-sm">名前<input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-control border border-hairline p-2" /></label><label className="text-sm">メールアドレス<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-control border border-hairline p-2" /></label><label className="text-sm">役割<select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="mt-1 w-full rounded-control border border-hairline p-2"><option value="admin">管理者</option><option value="staff">スタッフ</option><option value="viewer">閲覧のみ</option></select></label><label className="text-sm">最初に表示するLINEアカウント<select required value={assignedId} onChange={(e) => setAssignedId(e.target.value)} className="mt-1 w-full rounded-control border border-hairline p-2">{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></div><ScopeFields scope={scope} ids={scopeIds} accounts={accounts} setScope={(value) => { setScope(value); if (value === 'all') setScopeIds([]) }} toggle={(id) => toggle(id, scopeIds, setScopeIds)} /><Button type="submit" variant="primary">招待メールを送る</Button></form>
  </section>
}

function ScopeFields({ scope, ids, accounts, setScope, toggle }: { scope: 'all' | 'accounts'; ids: string[]; accounts: LineAccount[]; setScope: (scope: 'all' | 'accounts') => void; toggle: (id: string) => void }) {
  return <fieldset className="space-y-2"><legend className="text-sm font-semibold">担当範囲</legend><label className="mr-5 text-sm"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> 全店舗</label><label className="text-sm"><input type="radio" checked={scope === 'accounts'} onChange={() => setScope('accounts')} /> 指定した店舗</label>{scope === 'accounts' && <div className="grid gap-2 pt-2 sm:grid-cols-2">{accounts.map((account) => <label key={account.id} className="text-sm"><input type="checkbox" checked={ids.includes(account.id)} onChange={() => toggle(account.id)} /> {account.name}</label>)}</div>}</fieldset>
}
