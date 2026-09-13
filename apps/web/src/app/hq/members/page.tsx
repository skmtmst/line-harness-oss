'use client'

import { Plus } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { LineAccount, StaffMember } from '@line-crm/shared'
import MemberDialog, { type MemberDialogValue } from '@/components/hq/members/member-dialog'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import StickyBar from '@/components/shared/sticky-bar'
import SummaryCard from '@/components/shared/summary-card'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import { TextField } from '@/components/shared/text-field'
import { usePageTitle } from '@/components/shell/page-chrome'
import { api, ApiError } from '@/lib/api'
import {
  ROLE_LABELS,
  STATUS_LABELS,
  canResendInvite,
  lastLoginLabel,
  memberKpis,
  memberStatus,
  scopeLabel,
  sortMembers,
} from '@/lib/hq-members'

type Tab = 'members' | 'tenant'
type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/**
 * メンバー管理。★V6 36-5（`CRL4w`）。旧「統括設定」（/hq/settings）の権限者と統括名をここへ移した。
 *
 * L 一覧型: 1行目（タブ＋招待）→ 数値カード帯 → 案内帯 → 権限者の表。
 * 「統括の情報」タブは統括名の変更（旧設定画面のフォーム）。
 */
export default function HqMembersPage() {
  return (
    <Suspense fallback={null}>
      <MembersInner />
    </Suspense>
  )
}

function MembersInner() {
  usePageTitle('メンバー管理')
  const router = useRouter()
  const params = useSearchParams()
  const tab: Tab = params.get('tab') === 'tenant' ? 'tenant' : 'members'

  const [status, setStatus] = useState<LoadStatus>('loading')
  const [members, setMembers] = useState<StaffMember[]>([])
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [me, setMe] = useState<StaffMember | null>(null)
  const [lastLogins, setLastLogins] = useState<Record<string, string>>({})
  const [dialog, setDialog] = useState<{ open: boolean; member: StaffMember | null }>({ open: false, member: null })
  const [dialogBusy, setDialogBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [resendingId, setResendingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    setActionError('')
    try {
      const [staffRes, accountRes, meRes, loginRes] = await Promise.all([
        api.staff.list(),
        api.lineAccounts.list(),
        api.staff.me(),
        api.staff.lastLogins().catch(() => null),
      ])
      if (!staffRes.success) throw new Error(staffRes.error)
      setMembers(staffRes.data)
      if (accountRes.success) setAccounts(accountRes.data)
      if (meRes.success) setMe(meRes.data)
      if (loginRes?.success) setLastLogins(loginRes.data)
      setStatus('ready')
    } catch (caught) {
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])
  const kpis = memberKpis(members)
  const rows = sortMembers(members, me?.id ?? null)
  const canManage = me?.role === 'owner' || me?.role === 'admin'
  const restricted = me?.accountScope === 'accounts'

  const submitDialog = async (value: MemberDialogValue) => {
    setDialogBusy(true)
    setDialogError('')
    try {
      if (dialog.member) {
        const res = await api.staff.update(dialog.member.id, {
          role: value.role,
          isActive: value.isActive,
          accountScope: value.accountScope,
          scopedLineAccountIds: value.scopedLineAccountIds,
          managementContext: 'hq',
        })
        if (!res.success) throw new Error(res.error)
        setNotice(`${dialog.member.name}さんの権限を変更しました。`)
      } else {
        const res = await api.staff.create({
          name: value.name,
          email: value.email,
          role: value.role,
          assignedLineAccountId: value.assignedLineAccountId,
          accountScope: value.accountScope,
          scopedLineAccountIds: value.scopedLineAccountIds,
          managementContext: 'hq',
        })
        if (!res.success) throw new Error(res.error)
        setNotice(`${value.email} へ招待メールを送りました。`)
      }
      setDialog({ open: false, member: null })
      await load()
    } catch (caught) {
      setDialogError(caught instanceof Error && caught.message ? caught.message : '保存できませんでした。もう一度お試しください。')
    } finally {
      setDialogBusy(false)
    }
  }

  const resend = async (member: StaffMember) => {
    setResendingId(member.id)
    setActionError('')
    setNotice('')
    try {
      const res = await api.staff.resendInvite(member.id)
      if (!res.success) throw new Error(res.error)
      setNotice(`${member.email} へ招待メールを送り直しました。`)
    } catch (caught) {
      setActionError(caught instanceof Error && caught.message ? caught.message : '招待メールを送り直せませんでした。')
    } finally {
      setResendingId(null)
    }
  }

  const changeTab = (next: Tab) => router.replace(next === 'tenant' ? '/hq/members?tab=tenant' : '/hq/members')

  return (
    <div data-design-node="CRL4w" className="flex flex-col gap-4">
      <div data-design="Tabs" data-design-node="oGWXI">
        <Tabs
          items={[
            { label: '権限者', current: tab === 'members', onClick: () => changeTab('members') },
            { label: '統括の情報', current: tab === 'tenant', onClick: () => changeTab('tenant') },
          ]}
          actions={
            tab === 'members' && canManage && !restricted ? (
              <Button variant="primary" onClick={() => { setDialogError(''); setDialog({ open: true, member: null }) }}>
                <Plus aria-hidden="true" className="h-4 w-4" />
                権限者を招待
              </Button>
            ) : undefined
          }
        />
      </div>

      {tab === 'tenant' ? (
        <TenantInfoTab canEdit={Boolean(canManage)} />
      ) : (
        <>
          <div data-design="KPIs" data-design-node="kCaRU" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard variant="v6" title="権限者" value={status === 'ready' ? kpis.total : null} unit="人" detail={status === 'ready' ? `有効 ${kpis.active}人` : '—'} loading={status === 'loading'} />
            <SummaryCard variant="v6" title="招待中" value={status === 'ready' ? kpis.invited : null} unit="人" detail="未承諾の招待" loading={status === 'loading'} />
            <SummaryCard variant="v6" title="閲覧のみ" value={status === 'ready' ? kpis.viewers : null} unit="人" detail="編集できない権限者" loading={status === 'loading'} />
            <SummaryCard variant="v6" title="担当店舗の割り当て" value={status === 'ready' ? kpis.scopedAccounts : null} unit="店舗" detail={status === 'ready' ? `全店舗を担当 ${kpis.allScope}人` : '—'} loading={status === 'loading'} />
          </div>

          <div data-design="Note" data-design-node="Y1EarL">
            <NoteBar tone="info">
              権限者は統括の管理画面に入れる人です。担当店舗を限定すると、その店舗の管理画面だけが見えます。招待メールの有効期限は48時間です。
            </NoteBar>
          </div>

          {notice ? <p className="text-label text-accent-deep" role="status">{notice}</p> : null}
          {actionError ? <p className="text-label text-status-danger" role="alert">{actionError}</p> : null}

          <section data-design="Table" data-design-node="nLVwc">
            {status === 'loading' ? (
              <ListState kind="loading" title="権限者を読み込んでいます" />
            ) : status === 'forbidden' ? (
              <ListState kind="forbidden" />
            ) : status === 'error' ? (
              <ListState kind="error" title="権限者を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={() => void load()} />
            ) : restricted ? (
              <ListState kind="forbidden" title="全店舗の担当者だけが権限者を管理できます" description="担当店舗が限定されているため、権限者の一覧と変更はできません。" />
            ) : (
              <DataTable>
                <thead>
                  <TableHeadRow>
                    {/* 幅は画面が決める（部品は幅を持たない）。Pencil `U79TnM` の 260/300/120/200/120/160。 */}
                    <Th className="w-56">名前</Th>
                    <Th className="w-64">メールアドレス</Th>
                    <Th className="w-24">役割</Th>
                    <Th>担当範囲</Th>
                    <Th className="w-24">状態</Th>
                    <Th className="w-32">最終ログイン</Th>
                    <Th className="w-24" align="right">変更</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {rows.map((member) => {
                    const state = memberStatus(member)
                    const isSelf = member.id === me?.id
                    return (
                      <Tr key={member.id}>
                        <Td>
                          <span className="flex items-center gap-2.5">
                            <span
                              aria-hidden="true"
                              className={
                                isSelf
                                  ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-ink text-caption font-bold text-on-accent'
                                  : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-caption font-bold text-accent-deep'
                              }
                            >
                              {(member.name || '?').slice(0, 1).toUpperCase()}
                            </span>
                            <span className="min-w-0 truncate text-label font-semibold text-ink" title={member.name}>
                              {member.name}
                              {isSelf ? '（あなた）' : ''}
                            </span>
                          </span>
                        </Td>
                        <Td><span className="block truncate text-label text-ink-secondary" title={member.email ?? ''}>{member.email ?? '—'}</span></Td>
                        <Td>
                          <span
                            className={
                              member.role === 'owner' || member.role === 'admin'
                                ? 'inline-flex h-5.5 items-center rounded-pill bg-status-info-soft px-2 text-nano font-bold text-status-info'
                                : 'inline-flex h-5.5 items-center rounded-pill bg-shell px-2 text-nano font-bold text-ink-secondary'
                            }
                          >
                            {ROLE_LABELS[member.role]}
                          </span>
                        </Td>
                        <Td><span className="block truncate text-label text-ink" title={scopeLabel(member, accountNames)}>{scopeLabel(member, accountNames)}</span></Td>
                        <Td>
                          <span
                            className={
                              state === 'active'
                                ? 'inline-flex h-5.5 items-center rounded-pill bg-accent-soft px-2 text-nano font-bold text-accent-deep'
                                : state === 'invited'
                                  ? 'inline-flex h-5.5 items-center rounded-pill bg-status-warn-soft px-2 text-nano font-bold text-status-warn-deep'
                                  : state === 'expired'
                                    ? 'inline-flex h-5.5 items-center rounded-pill bg-status-danger-soft px-2 text-nano font-bold text-status-danger'
                                    : 'inline-flex h-5.5 items-center rounded-pill bg-step-idle px-2 text-nano font-bold text-ink-secondary'
                            }
                          >
                            {STATUS_LABELS[state]}
                          </span>
                        </Td>
                        <Td><span className="text-label text-ink-faint">{lastLoginLabel(lastLogins[member.id])}</span></Td>
                        <Td align="right">
                          {canManage ? (
                            <span className="inline-flex items-center gap-3">
                              {canResendInvite(member) ? (
                                <button
                                  type="button"
                                  disabled={resendingId === member.id}
                                  onClick={() => void resend(member)}
                                  className="text-label font-semibold text-accent-deep hover:underline disabled:opacity-50"
                                >
                                  {resendingId === member.id ? '送信中…' : '再送'}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => { setDialogError(''); setDialog({ open: true, member }) }}
                                aria-label={`${member.name}さんの権限を変更`}
                                className="text-label font-semibold text-accent-deep hover:underline"
                              >
                                変更
                              </button>
                            </span>
                          ) : null}
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </DataTable>
            )}
          </section>

          <MemberDialog
            open={dialog.open}
            member={dialog.member}
            accounts={accounts}
            isSelf={dialog.member?.id === me?.id}
            busy={dialogBusy}
            error={dialogError}
            onSubmit={(value) => void submitDialog(value)}
            onCancel={() => {
              if (dialogBusy) return
              setDialog({ open: false, member: null })
            }}
          />
        </>
      )}
    </div>
  )
}

/** 「統括の情報」タブ。統括名の変更（旧 /hq/settings のフォーム）。 */
function TenantInfoTab({ canEdit }: { canEdit: boolean }) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.tenants.me()
      .then((response) => {
        if (!cancelled && response.success) setName(response.data.name)
      })
      .catch(() => {
        if (!cancelled) setError('統括名を読み込めませんでした。時間をおいてもう一度お試しください。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const save = async (event?: FormEvent) => {
    event?.preventDefault()
    const trimmed = name.trim()
    setSaved(false)
    if (!trimmed) return setError('統括名を入力してください。')
    if (trimmed.length > 100) return setError('統括名は100文字以内で入力してください。')
    setSaving(true)
    setError('')
    try {
      const response = await api.tenants.updateName(trimmed)
      if (!response.success) throw new Error(response.error)
      setName(response.data.name)
      setSaved(true)
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : '統括名を保存できませんでした。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <NoteBar tone="info">統括名は、統括コンソールとメールの差出人に使われます。店舗の名前はそれぞれの店舗の設定で変えます。</NoteBar>
      <form onSubmit={save} className="flex max-w-2xl flex-col gap-4 rounded-card border border-hairline bg-canvas p-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tenant-name" className="text-label font-bold text-ink">統括名</label>
          <p className="text-micro text-ink-faint">100文字以内で入力してください。</p>
          <TextField
            id="tenant-name"
            value={name}
            maxLength={100}
            disabled={loading || saving || !canEdit}
            onChange={(event) => { setName(event.target.value); setSaved(false) }}
            className="w-full"
          />
        </div>
        {error ? <p className="text-label text-status-danger" role="alert">{error}</p> : null}
        {saved ? <p className="text-label text-accent-deep" role="status">保存しました。</p> : null}
      </form>
      <div className="sticky bottom-0 z-10">
        <StickyBar
          status={canEdit ? undefined : '統括名の変更は管理者だけができます'}
          actions={
            <Button variant="primary" onClick={() => void save()} disabled={loading || saving || !canEdit}>
              {saving ? '保存中…' : '統括名を保存'}
            </Button>
          }
        />
      </div>
    </>
  )
}
