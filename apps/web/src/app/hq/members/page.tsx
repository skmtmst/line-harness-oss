'use client'

import HqSettingsNav from '@/app/hq/hq-settings-nav-v8'
import ReadonlyHeader from '@/app/hq/readonly-header-v8'
import '@/app/hq/readonly-v8.css'
import { Plus } from 'lucide-react'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type { LineAccount, StaffMember } from '@line-crm/shared'
import MemberDialog, { type MemberDialogValue } from '@/components/hq/members/member-dialog'
import StepUpPrompt from '@/components/step-up-prompt'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { usePageTitle } from '@/components/shell/page-chrome'
import { describeApiFailure, japaneseDetailOf } from '@/components/shared/api-error-message'
import { api, ApiError } from '@/lib/api'
import {
  ROLE_LABELS,
  STATUS_LABELS,
  canResendInvite,
  lastLoginLabel,
  memberStatus,
  scopeLabel,
  sortMembers,
} from '@/lib/hq-members'
import './hq-members-v8.css'
import { useAdminTheme } from '@/lib/use-admin-theme'
import HqMembersV8 from '@/v8/hq/members'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/**
 * メンバー管理。板 yLKwV（招待）・BHEl9（権限の変更）（V8 のみ）。
 *
 * 左に「統括の設定」の中のメニュー、右に権限者の表。
 * 「統括の情報」（統括名の変更）は /hq/settings に置く。
 */
export default function HqMembersPage() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <HqMembersV8 /> : <HqMembersPageV7 />
}

function HqMembersPageV7() {
  return (
    <Suspense fallback={null}>
      <MembersInner />
    </Suspense>
  )
}

function MembersInner() {
  usePageTitle('メンバー管理')

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
  /* 権限変更が STEP_UP_REQUIRED で止まったときの本人確認。通ったら grant を付けて同じ保存をやり直す。 */
  const [stepUp, setStepUp] = useState<null | { retry: (token: string) => Promise<void> }>(null)
  /* 板 `M4jS9`「権限を変える確認」。変える前に変更前→変更後を見せる。 */
  const [confirmChange, setConfirmChange] = useState<{ member: StaffMember; value: MemberDialogValue } | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    setActionError('')
    try {
      // M025: 範囲限定の担当者に一覧は出さない（口も403で断る）。
      // 先に自分を読んで理由の分かる面を出し、通らない一覧は呼ばない。
      const meRes = await api.staff.me()
      if (!meRes.success) throw new Error(meRes.error)
      setMe(meRes.data)
      if (meRes.data.accountScope === 'accounts') {
        setStatus('ready')
        return
      }
      const [staffRes, accountRes, loginRes] = await Promise.all([
        api.staff.list(),
        api.lineAccounts.list(),
        api.staff.lastLogins().catch(() => null),
      ])
      if (!staffRes.success) throw new Error(staffRes.error)
      setMembers(staffRes.data)
      if (accountRes.success) setAccounts(accountRes.data)
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
  const rows = sortMembers(members, me?.id ?? null)
  const canManage = me?.role === 'owner' || me?.role === 'admin'
  const restricted = me?.accountScope === 'accounts'

  const submitDialog = async (value: MemberDialogValue, stepUpToken?: string) => {
    setDialogBusy(true)
    setDialogError('')
    try {
      if (dialog.member) {
        const res = await api.staff.update(dialog.member.id, {
          role: value.role,
          isActive: value.isActive,
          assignedLineAccountId: value.assignedLineAccountId,
          accountScope: value.accountScope,
          scopedLineAccountIds: value.scopedLineAccountIds,
          managementContext: 'hq',
        }, stepUpToken)
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
      if (!stepUpToken && caught instanceof ApiError && caught.code === 'STEP_UP_REQUIRED') {
        setStepUp({ retry: (token) => submitDialog(value, token) })
        return
      }
      // M026：原文のまま出さず、共通の状態別案内へ渡す（本人確認の分岐は先に残す）。
      setDialogError(japaneseDetailOf(caught) || describeApiFailure(caught, '保存', {
        forbidden: '権限者の招待・変更はオーナーか管理者だけができます。必要なときはオーナーか管理者の方に操作してもらってください。',
      }))
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
      // M026：再試行の言葉がない代替文にしない。共通の状態別案内へ渡す。
      setActionError(japaneseDetailOf(caught) || describeApiFailure(caught, '招待メールの再送', {
        forbidden: '招待メールの再送はオーナーか管理者だけができます。必要なときはオーナーか管理者の方に操作してもらってください。',
      }))
    } finally {
      setResendingId(null)
    }
  }

  return (
    <div data-design-node="r4ARpV" className="flex flex-col gap-4">
      <ReadonlyHeader
        title="メンバー"
        description="統括の画面に入れる人です。役割と、見られるアカウント（担当範囲）を決めます。"
        actions={
          status === 'ready' && canManage && !restricted ? (
            <Button variant="primary" onClick={() => { setDialogError(''); setDialog({ open: true, member: null }) }}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              権限者を招待
            </Button>
          ) : undefined
        }
      />
      <div className="hq-members-v8">
        <HqSettingsNav active="members" />
        <div className="hq-members-v8__main">
          {notice ? <p className="text-label text-accent-deep" role="status">{notice}</p> : null}
          {actionError ? <p className="text-label text-danger" role="alert">{actionError}</p> : null}

          <section data-design="Table" data-design-node="nLVwc">
            {status === 'loading' ? (
              <ListState kind="loading" title="権限者を読み込んでいます" />
            ) : status === 'forbidden' ? (
              <ListState kind="forbidden" />
            ) : status === 'error' ? (
              <ListState kind="error" title="権限者を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={() => void load()} />
            ) : restricted ? (
              <ListState kind="forbidden" title="全アカウントの担当者だけが権限者を管理できます" description="担当アカウントが限定されているため、権限者の一覧と変更はできません。" />
            ) : (
              <>
              {/*
                U042: 768px 未満では表の右端の「変更」へ横スクロールしないと
                届かなかった。スマホでは名前＋役割・状態＋操作が先に見える
                カードにし、メールや最終ログインは開いて確認する形にする。
              */}
              <ul className="divide-y divide-hairline rounded-card border border-hairline bg-canvas md:hidden" data-design="Table">
                {rows.map((member) => {
                  const state = memberStatus(member)
                  const isSelf = member.id === me?.id
                  return (
                    <li key={member.id} className="p-4">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className={
                            isSelf
                              ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-ink text-caption font-medium text-on-accent'
                              : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-caption font-medium text-accent-deep'
                          }
                        >
                          {(member.name || '?').slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-label font-semibold text-ink" title={member.name}>
                          {member.name}
                          {isSelf ? '（あなた）' : ''}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={
                            member.role === 'owner' || member.role === 'admin'
                              ? 'inline-flex h-5.5 items-center rounded-pill bg-status-info-soft px-2 text-nano font-medium text-status-info'
                              : 'inline-flex h-5.5 items-center rounded-pill bg-shell px-2 text-nano font-medium text-ink-secondary'
                          }
                        >
                          {ROLE_LABELS[member.role]}
                        </span>
                        <span
                          className={
                            state === 'active'
                              ? 'inline-flex h-5.5 items-center rounded-pill bg-accent-soft px-2 text-nano font-medium text-accent-deep'
                              : state === 'invited'
                                ? 'inline-flex h-5.5 items-center rounded-pill bg-status-warn-soft px-2 text-nano font-medium text-status-warn-deep'
                                : state === 'expired'
                                  ? 'inline-flex h-5.5 items-center rounded-pill bg-status-danger-soft px-2 text-nano font-medium text-danger'
                                  : 'inline-flex h-5.5 items-center rounded-pill bg-step-idle px-2 text-nano font-medium text-ink-secondary'
                          }
                        >
                          {STATUS_LABELS[state]}
                        </span>
                      </div>
                      {canManage ? (
                        <div className="mt-3 flex items-center gap-4">
                          {canResendInvite(member) ? (
                            <button
                              type="button"
                              disabled={resendingId === member.id}
                              onClick={() => void resend(member)}
                              className="text-label font-semibold text-action hover:underline disabled:opacity-50"
                            >
                              {resendingId === member.id ? '送信中…' : '招待メールを再送'}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => { setDialogError(''); setDialog({ open: true, member }) }}
                            aria-label={`${member.name}さんの権限を変更`}
                            className="text-label font-semibold text-action hover:underline"
                          >
                            権限を変更
                          </button>
                        </div>
                      ) : null}
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-semibold text-ink-secondary">詳しい情報を見る</summary>
                        <dl className="mt-2 space-y-1 text-xs">
                          <div className="flex justify-between gap-3"><dt className="text-ink-faint">メールアドレス</dt><dd className="min-w-0 truncate text-ink-secondary" title={member.email ?? ''}>{member.email ?? '—'}</dd></div>
                          <div className="flex justify-between gap-3"><dt className="text-ink-faint">担当範囲</dt><dd className="min-w-0 truncate text-ink" title={scopeLabel(member, accountNames)}>{scopeLabel(member, accountNames)}</dd></div>
                          <div className="flex justify-between gap-3"><dt className="text-ink-faint">最終ログイン</dt><dd className="text-ink-faint">{lastLoginLabel(lastLogins[member.id])}</dd></div>
                        </dl>
                      </details>
                    </li>
                  )
                })}
              </ul>
              <div className="hidden md:block">
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
                                  ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-ink text-caption font-medium text-on-accent'
                                  : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-caption font-medium text-accent-deep'
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
                                ? 'inline-flex h-5.5 items-center rounded-pill bg-status-info-soft px-2 text-nano font-medium text-status-info'
                                : 'inline-flex h-5.5 items-center rounded-pill bg-shell px-2 text-nano font-medium text-ink-secondary'
                            }
                          >
                            {ROLE_LABELS[member.role]}
                          </span>
                        </Td>
                        <Td><span className="block truncate text-label text-ink" title={scopeLabel(member, accountNames)}>{scopeLabel(member, accountNames)}</span></Td>
                        <Td>
                          <Chip tone={state === 'active' ? 'ok' : state === 'invited' ? 'warn' : state === 'expired' ? 'danger' : 'neutral'}>
                            {STATUS_LABELS[state]}
                          </Chip>
                        </Td>
                        <Td><span className="text-label text-ink-faint">{lastLoginLabel(lastLogins[member.id])}</span></Td>
                        <Td align="right">
                          {canManage ? (
                            <span className="inline-flex items-center gap-2">
                              {canResendInvite(member) ? (
                                <button
                                  type="button"
                                  disabled={resendingId === member.id}
                                  onClick={() => void resend(member)}
                                  className="text-label font-semibold text-action hover:underline disabled:opacity-50"
                                >
                                  {resendingId === member.id ? '送信中…' : '再送'}
                                </button>
                              ) : null}
                              <Button
                                size="compact"
                                onClick={() => { setDialogError(''); setDialog({ open: true, member }) }}
                                aria-label={`${member.name}さんの権限を変更`}
                              >
                                変更
                              </Button>
                            </span>
                          ) : null}
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </DataTable>
              </div>
              </>
            )}
          </section>

          <MemberDialog
            open={dialog.open}
            member={dialog.member}
            accounts={accounts}
            isSelf={dialog.member?.id === me?.id}
            busy={dialogBusy}
            error={dialogError}
            onSubmit={(value) => {
              if (dialog.member) {
                setConfirmChange({ member: dialog.member, value })
              } else {
                void submitDialog(value)
              }
            }}
            onCancel={() => {
              if (dialogBusy) return
              setDialog({ open: false, member: null })
            }}
          />
          {confirmChange ? (
            <MemberChangeConfirm
              member={confirmChange.member}
              value={confirmChange.value}
              accountNames={accountNames}
              busy={dialogBusy}
              error={dialogError}
              onCancel={() => { if (!dialogBusy) setConfirmChange(null) }}
              onConfirm={() => {
                const pending = confirmChange
                setConfirmChange(null)
                void submitDialog(pending.value)
              }}
            />
          ) : null}
          {stepUp ? (
            <StepUpPrompt
              request={{ purpose: 'staff.permissions.change', action: 'メンバーの権限を変更する', retry: stepUp.retry }}
              onDone={() => setStepUp(null)}
              onClose={() => setStepUp(null)}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

const ROLE_LABEL: Record<string, string> = { owner: '所有者', admin: '管理者', staff: 'スタッフ', viewer: '閲覧のみ' }

/** 板 `M4jS9`「権限を変える確認」。変更前→変更後を並べてから変える。 */
function MemberChangeConfirm({ member, value, accountNames, busy, error, onCancel, onConfirm }: {
  member: StaffMember
  value: MemberDialogValue
  accountNames: Map<string, string>
  busy: boolean
  error: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const roleOf = (role: string) => ROLE_LABEL[role] ?? role
  const scopeOf = (scope: 'all' | 'accounts', ids: string[]) => (
    scope === 'all' ? 'すべてのアカウント' : ids.map((id) => accountNames.get(id) ?? id).join('・') || '（選択なし）'
  )
  const beforeScope = member.accountScope ?? 'all'
  const beforeIds = member.scopedLineAccountIds ?? []
  const rows = [
    { label: '役割', before: roleOf(member.role), after: roleOf(value.role), changed: member.role !== value.role },
    {
      label: '担当範囲',
      before: scopeOf(beforeScope, beforeIds),
      after: scopeOf(value.accountScope, value.scopedLineAccountIds),
      changed: beforeScope !== value.accountScope || beforeIds.join(',') !== value.scopedLineAccountIds.join(','),
    },
    {
      label: '状態',
      before: member.isActive ? '有効' : '停止中',
      after: value.isActive ? '有効' : '停止中',
      changed: member.isActive !== value.isActive,
    },
  ]
  return (
    <ConfirmDialog
      open
      title={`${member.name}さんの権限を変えますか？`}
      description="変える内容を確かめてから変えてください。管理者が1人だけのときは、その管理者を外せません。"
      confirmLabel="変える"
      busy={busy}
      error={error || undefined}
      designNode="M4jS9"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <dl className="grid gap-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 border-b border-hairline pb-1.5">
            <dt className="w-16 shrink-0 text-caption text-ink-faint">{row.label}</dt>
            <dd className="min-w-0 flex-1 truncate text-caption text-ink">{row.before} → {row.after}</dd>
            {row.changed ? <Chip tone="warn">変わる</Chip> : null}
          </div>
        ))}
      </dl>
    </ConfirmDialog>
  )
}
