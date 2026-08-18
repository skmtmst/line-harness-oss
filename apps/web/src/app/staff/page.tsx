'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import LoginAudit from '@/components/staff/login-audit'
import { ApiError, api } from '@/lib/api'
import type { StaffMember } from '@line-crm/shared'

const TABS = [
  { key: 'members', label: '管理スタッフ' },
  { key: 'permissions', label: '権限' },
  { key: 'audit', label: 'ログイン履歴' },
]

const ROLE_LABEL: Record<string, string> = { owner: '管理者', admin: '管理者', staff: 'スタッフ', viewer: '閲覧のみ' }
const INVITE_LABEL: Record<string, string> = { pending_email: 'メール確認待ち', pending_line: 'LINE連携待ち', active: '利用中', expired: '期限切れ' }

/** 例外を、画面に出せる一文にする。 */
function messageOf(e: unknown): string {
  if (e instanceof ApiError) return `${e.message}（${e.status}）`
  return e instanceof Error ? e.message : '通信に失敗しました'
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="bg-canvas rounded-card border-hairline border p-4"><p className="text-ink-secondary text-sm font-medium">{label}</p><p className="text-ink mt-2 text-3xl font-bold tabular-nums">{value}</p><p className="text-ink-faint mt-1 text-xs">{note}</p></div>
}

function Members() {
  const [members, setMembers] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.staff.list()
      if (res.success) setMembers(res.data); else setError(res.error)
    } catch (e) {
      setError(messageOf(e))
    }
    setLoading(false)
  }
  useEffect(() => { void load() }, [])
  const shown = useMemo(() => members.filter((m) => `${m.name} ${m.email ?? ''}`.toLowerCase().includes(query.toLowerCase())), [members, query])
  const admins = members.filter((m) => m.role === 'admin' || m.role === 'owner').length
  const linked = members.filter((m) => m.lineLinked).length

  /**
   * 通信に失敗すると fetchApi は例外を投げる。受けずに放っておくと
   * 「押しても何も起きない」画面になり、原因が誰にも分からなくなる。
   * ここで必ず文字にして出す。
   */
  const run = async (action: () => Promise<{ success: boolean; error?: string }>) => {
    setError('')
    try {
      const res = await action()
      if (res.success) await load()
      else setError(res.error ?? '操作できませんでした')
    } catch (e) {
      setError(messageOf(e))
    }
  }

  const toggle = (member: StaffMember) =>
    run(() => api.staff.update(member.id, { isActive: !member.isActive }))

  const unlink = (member: StaffMember) => {
    if (!confirm(`${member.name} のLINE連携を解除します。本人は招待メールから連携をやり直す必要があります。`)) return
    return run(() => api.staff.update(member.id, { lineLinked: false }))
  }

  const remove = (member: StaffMember) => {
    if (!confirm(`${member.name} を削除します。この操作は取り消せません。`)) return
    return run(() => api.staff.delete(member.id))
  }

  return <>
    <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Kpi label="管理スタッフ" value={`${members.length}人`} note={`管理者 ${admins}人・スタッフ ${members.length - admins}人`} />
      <Kpi label="二要素認証" value={`${linked}人`} note={`LINE連携済み・未連携 ${members.length - linked}人`} />
      <Kpi label="過去30日のログイン" value="—" note="ログイン履歴から確認できます" />
      <Kpi label="最終ログイン" value="—" note="操作日時を確認してください" />
    </div>
    <div className="bg-canvas rounded-card border-hairline border">
      <div className="border-hairline flex flex-wrap items-center gap-3 border-b p-4">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名前・メールアドレスで検索" className="border-hairline rounded-control min-w-64 flex-1 border px-3 py-2 text-sm outline-none focus:border-accent" />
        <span className="text-ink-faint text-sm">{shown.length}人</span>
      </div>
      {error && <p className="bg-danger-bg text-danger m-4 rounded-control p-3 text-sm">{error}</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-sm">
        <thead><tr className="bg-canvas-sunken border-hairline border-b text-left text-xs text-ink-faint"><th className="px-4 py-3">名前</th><th className="px-4 py-3">メールアドレス</th><th className="px-4 py-3">権限</th><th className="px-4 py-3">LINE連携</th><th className="px-4 py-3">状態</th><th className="px-4 py-3 text-right">操作</th></tr></thead>
        <tbody className="divide-hairline divide-y">{loading ? <tr><td colSpan={6} className="p-8 text-center text-ink-faint">読み込み中...</td></tr> : shown.map((m) => <tr key={m.id} className="hover:bg-canvas-sunken">
          <td className="px-4 py-3 font-medium text-ink">{m.name}</td><td className="px-4 py-3 text-ink-secondary">{m.email ?? '—'}</td>
          <td className="px-4 py-3"><span className="rounded-pill bg-accent-bg px-2 py-1 text-xs font-medium text-accent">{ROLE_LABEL[m.role] ?? 'スタッフ'}</span></td>
          <td className="px-4 py-3 text-ink-secondary">{m.lineLinked ? '連携済み' : '未連携'}</td>
          <td className="px-4 py-3"><span className={m.isActive ? 'text-success' : 'text-warning'}>{m.isActive ? '有効' : INVITE_LABEL[m.inviteStatus] ?? '無効'}</span></td>
          <td className="px-4 py-3"><div className="flex justify-end gap-2">
            <button onClick={() => void toggle(m)} className="cursor-pointer rounded-control border border-hairline px-3 py-1.5 text-xs text-ink-secondary hover:bg-canvas-sunken">{m.isActive ? '無効にする' : '有効にする'}</button>
            {m.lineLinked && <button onClick={() => void unlink(m)} className="cursor-pointer rounded-control border border-hairline px-3 py-1.5 text-xs text-ink-secondary hover:bg-canvas-sunken">連携を解除</button>}
            <button onClick={() => void remove(m)} className="cursor-pointer rounded-control border border-hairline px-3 py-1.5 text-xs text-danger hover:bg-danger-bg">削除</button>
          </div></td>
        </tr>)}</tbody>
      </table></div>
    </div>
  </>
}

function Permissions() {
  return <div className="grid gap-4 md:grid-cols-3">
    {[
      ['管理者', 'すべての権限で設定・操作できます'],
      ['スタッフ', '選択した機能だけを操作できます'],
      ['閲覧のみ', 'すべて閲覧できますが、操作はできません'],
    ].map(([title, note]) => <div key={title} className="bg-canvas rounded-card border-hairline min-h-28 border p-5"><h2 className="text-ink font-semibold">{title}</h2><p className="text-ink-secondary mt-2 text-sm">{note}</p></div>)}
  </div>
}

function PageContent() {
  const tab = useMergedTab(TABS, 'tab', 'audit')
  return <div>
    <div data-design="Head"><Header title="ログインユーザー" description="管理画面にログインできる人と、その権限を管理します。誰がいつ何をしたかの記録も残ります。" action={<div className="flex gap-2"><button disabled className="rounded-control border border-hairline px-4 py-2 text-sm text-ink-faint opacity-50">マニュアル</button><Link href="/staff/new" className="cursor-pointer rounded-control bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover">＋ ユーザーを追加</Link></div>} /></div>
    <MergedTabs basePath="/staff" tabs={TABS} active={tab} defaultKey="audit" />
    {tab === 'members' ? <Members /> : tab === 'permissions' ? <Permissions /> : <LoginAudit />}
  </div>
}

export default function StaffPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中...</div>}><PageContent /></Suspense>
}
