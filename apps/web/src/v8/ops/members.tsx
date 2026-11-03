'use client'

import { requiredText } from '@/lib/form-requirement'
const inviteEmailRequirement = requiredText('招待する人のメールアドレスを入れてください')
import { useUrlTab } from '@/lib/use-url-tab'
import { Eye, LogIn, Send, Users } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type OpsMember, type OpsMemberSummary } from '@/lib/api'
import { opsCall } from '@/components/ops/ops-ui'
import NoticeLineAccountCard from '@/components/ops/notice-line-account-card'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import OperationTargetSummary from '@/components/shared/operation-target-summary'
import KpiCard from '@/components/shared/kpi-card'
import KpiBand from '@/components/shared/kpi-band'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import { Tabs } from '@/components/shared/tabs'
import { Field } from '@/components/shared/form-controls'
import { TextField } from '@/components/shared/text-field'
import { OpsHead } from './shell'
import { OPS_READONLY_LOCK_REASON } from './use-ops-read-only'
import type { ActionMenuItem } from '@/components/shared/action-menu'
import { PageFrame } from '@/components/templates/page-frame'
import parts from './parts.module.css'
import styles from './members.module.css'
import { formatDate as polishFormatDate, formatDateTime, formatNumber } from '@/lib/format'
import { emptyValue } from '@/components/shared/empty-value'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import Notice from '@/components/shared/notice'
import { GridTable, GridHeadRow, GridRow, GridCell, GridNameCell } from '@/components/shared/grid-table'
import TruncatedText from '@/components/shared/truncated-text'
import { RowActions } from '@/components/shared/row-actions'

/**
 * 運営のメンバー管理 V8（絵の停止の窓 ）。
 *
 * 動きは 管理画面（app/ops/members）と同じ口：一覧（/api/ops/members）・招待・再送・
 * 停止／再開。自分自身の行には操作を置かない。閲覧のみの運営メンバー
 * （/api/ops/me の readOnly）には、招待も行の「…」も押せない形＋理由で出す
 * （決まり：隠さず灰色＋理由）。役割が分かるまでは理由なしの押せない形。
 */

type PendingAction = { member: OpsMember; kind: 'stop' | 'resume' | 'cancel' }

/** 行の「…」の中身。閲覧のみは押せない形＋理由、役割が分かるまでは理由なしの押せない形。 */
function memberRowItems(m: OpsMember, access: 'unknown' | 'readonly' | 'writer', invited: boolean, onResend: () => void, onPending: (kind: 'stop' | 'resume' | 'cancel') => void): ActionMenuItem[] {
  const items: ActionMenuItem[] = invited ? [
    { id: 'resend', label: '招待を再送する', onSelect: onResend },
    { id: 'cancel', label: '取り消す', tone: 'danger', onSelect: () => onPending('cancel') },
  ] : [{ id: 'state', label: m.isActive ? '停止する' : '再開する', tone: m.isActive ? 'danger' : undefined, onSelect: () => onPending(m.isActive ? 'stop' : 'resume') }]
  if (access === 'readonly') return items.map(({ onSelect: _onSelect, ...item }) => ({ ...item, disabled: false, lockedReason: OPS_READONLY_LOCK_REASON }))
  if (access === 'unknown') return items.map((item) => ({ ...item, disabled: true }))
  return items
}

export default function OpsMembersV8() {
  const [members, setMembers] = useState<OpsMember[]>([])
  const [summary, setSummary] = useState<OpsMemberSummary | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useUrlTab(['members', 'info'] as const, 'members')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [listFailed, setListFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [me, setMe] = useState<string | null>(null)
  const [access, setAccess] = useState<'unknown' | 'readonly' | 'writer'>('unknown')
  const lock = access === 'readonly' ? OPS_READONLY_LOCK_REASON : undefined
  const unknown = access === 'unknown'
  const [pending, setPending] = useState<PendingAction | null>(null)
  const pendingRef = useRef<PendingAction | null>(null)
  useEffect(() => () => { pendingRef.current = null }, [])
  const [notice, setNotice] = useState('')
  const [resendingId, setResendingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError('')
    setListFailed(false)
    const [res, meRes] = await Promise.all([opsCall(api.ops.members()), opsCall(api.ops.me())])
    setLoaded(true)
    if (meRes.success) { setMe(meRes.data.id); setAccess(meRes.data.readOnly ? 'readonly' : 'writer') }
    if (!res.success) { setError(res.error || '読み込めませんでした'); setListFailed(true); return }
    setMembers(res.data)
    setSummary(res.summary)
  }, [])

  useEffect(() => { void load() }, [load])

  const [inviteError, setInviteError] = useState<string | null>(null)
  const invite = async (event: FormEvent) => {
    event.preventDefault()
    if (access !== 'writer') return
    const problem = inviteEmailRequirement.check(email)
    setInviteError(problem)
    if (problem) return
    setBusy(true)
    setError('')
    const res = await opsCall(api.ops.addMember({ email: email.trim() }))
    setBusy(false)
    if (!res.success) { setError(res.error || '招待できませんでした。時間をおいて、もう一度お試しください。'); return }
    setNotice(res.data.activationState === 'active'
      ? '最初の運営メンバーとして登録しました'
      : `${email.trim()} に招待メールを送りました。相手が二段階認証の登録を終えると運営メンバーになります`)
    setEmail('')
    void load()
  }

  const resend = async (member: OpsMember) => {
    if (access !== 'writer') return
    setResendingId(member.staffId)
    setError('')
    const res = await opsCall(api.ops.resendInvite(member.staffId))
    setResendingId(null)
    if (!res.success) { setError(res.error || '送り直せませんでした'); return }
    setNotice(`${member.email ?? member.name} に招待メールを送り直しました`)
    void load()
  }

  const applyPending = async () => {
    if (!pending || pendingRef.current !== pending || access !== 'writer') return
    pendingRef.current = null
    setBusy(true)
    setError('')
    const res = await opsCall(api.ops.setMemberActive(pending.member.staffId, pending.kind === 'resume'))
    setBusy(false)
    if (!res.success) { pendingRef.current = pending; setError(res.error || '変更できませんでした。時間をおいて、もう一度お試しください。'); return }
    setPending(null)
    void load()
  }

  const active = summary ? summary.members - summary.invited : null

  return (
    <PageFrame kind="list" boardId="FvbHW" standalone skeleton>
      <OpsHead
        title="メンバー管理"
        description="運営メンバーはメールで招待します。招待された人はパスワードを設定し、二段階認証の登録が終わるまで運営コンソールに入れません。自分自身は変えられません。"
      />
      <div className={parts.stack}>
        <div className={parts.tabs}>
        <Tabs
          label="メンバー管理の中身"
          items={[
            { label: summary ? `運営メンバー ${summary.members}` : '運営メンバー', current: tab === 'members', onClick: () => setTab('members') },
            { label: '運営の情報', current: tab === 'info', onClick: () => setTab('info') },
          ]}
        />
        </div>

        {tab === 'members' ? (
          <>
            <KpiBand gridClassName="grid grid-cols-3">
              <KpiCard presentation="cell" icon={<Users size={16} aria-hidden="true" />} title="運営メンバー" value={summary ? summary.members : null} unit="人" detail={summary ? <span title={`二段階認証 設定済み ${summary.totpEnabled}人 / ${formatNumber(summary.members)}人・未設定 ${Math.max(0, summary.members - summary.totpEnabled)}人`}>{`有効 ${active}・招待中 ${summary.invited}`}</span> : emptyValue('unknown')} loading={!loaded} />
              <KpiCard presentation="cell" icon={<LogIn size={16} aria-hidden="true" />} title="今月の代理ログイン" value={summary ? summary.impersonationsThisMonth : null} unit="回" detail="監査ログに記録" loading={!loaded} />
              <KpiCard presentation="cell" icon={<Eye size={16} aria-hidden="true" />} title="今月の個人情報の表示" value={summary ? summary.piiRevealsThisMonth : null} unit="回" detail="監査ログに記録" loading={!loaded} />
            </KpiBand>

            <form onSubmit={(event) => void invite(event)} className={styles.invite}>
              <div className={styles.inviteField}>
                <Field label="招待する人のメールアドレス" requirement={inviteEmailRequirement} error={inviteError}><SaveErrorField names={["email"]}><TextField
                  type="email"
                  value={email}
                  onChange={(event) => { setEmail(event.target.value); setInviteError(null) }}
                  placeholder="招待する人のメールアドレス"
                  aria-label="招待する人のメールアドレス"
                  autoComplete="off"
                  disabled={busy || access !== 'writer'}
                /></SaveErrorField></Field>
              </div>
              <Button type="submit" variant="primary" lockedReason={lock} disabled={busy || unknown}>
                <Send aria-hidden="true" />招待メールを送る
              </Button>
            </form>

            {notice ? <p role="status" className={parts.status}>{notice}</p> : null}
            {error && !listFailed ? <Notice tone="danger" className={parts.alertNoticePlacement} >{error}</Notice> : null}

            {!loaded ? (
              <ListState permissionScope="hq" kind="loading" title="運営メンバーを読み込んでいます" />
            ) : listFailed ? (
              <div className={parts.panel}>
                <ListState permissionScope="hq" kind="error" title="運営メンバーを表示できませんでした" description={error} onRetry={() => void load()} />
              </div>
            ) : members.length === 0 ? (
              <div className={parts.panel}>
                <ListState permissionScope="hq" kind="empty" title="運営メンバーがいません" description="最初の 1 人は、自分のメールアドレスを入れて「招待メールを送る」を押して登録します。" />
              </div>
            ) : (
              <GridTable label="運営メンバー" design={{ columns: 'minmax(0, 1fr) minmax(0, 1fr) var(--tpl-rt-col-130) var(--tpl-op-mem-state-w) var(--tpl-op-mem-login-w) var(--tpl-op-mem-ops-w)', gap: 'var(--polish-space-card)', rowPadding: '0 var(--tpl-list-inset)', fontSize: 'var(--polish-text-body)' }}>
                <GridHeadRow>
                  <GridCell role="columnheader">名前</GridCell>
                  <GridCell role="columnheader">メール</GridCell>
                  <GridCell role="columnheader">二段階認証</GridCell>
                  <GridCell role="columnheader">状態</GridCell>
                  <GridCell role="columnheader">最終ログイン</GridCell>
                  <GridCell role="columnheader">操作</GridCell>
                </GridHeadRow>
                {members.map((m) => {
                  const self = m.staffId === me
                  const invited = m.isActive && m.activationState !== 'active'
                  return (
                    <GridRow key={m.staffId}>
                      <GridNameCell folder={false} name={<TruncatedText value={`${m.name}${self ? '（自分）' : ''}`} />} />
                      <GridCell><TruncatedText value={m.email ?? emptyValue('unknown')} /></GridCell>
                      <GridCell>{totpChip(m)}</GridCell>
                      <GridCell>{stateChip(m)}</GridCell>
                      <GridCell><span className={styles.shortText} title={m.lastLoginAt ? formatDateTime(m.lastLoginAt) : undefined}>{shortDateTime(m.lastLoginAt)}</span></GridCell>
                      <GridCell align="right">
                        {access === 'writer' && self ? (
                          <RowActions subjectName={m.name} menuButtonProps={{ disabled: true, title: '自分の運営アカウントは停止・取り消しできません' }} menuNote="自分の運営アカウントは停止・取り消しできません" />
                        ) : (
                          <RowActions subjectName={m.name} menuButtonProps={{ disabled: busy || resendingId !== null }} menuItems={memberRowItems(m, access, invited, () => { void resend(m) }, (kind) => { const action = { member: m, kind }; pendingRef.current = action; setPending(action) })} />
                        )}
                      </GridCell>
                    </GridRow>
                  )
                })}
              </GridTable>
            )}
          </>
        ) : (
          <div className={parts.stack}>
            <NoticeLineAccountCard />
            <div className={parts.panel}>
              <p className={parts.line}>
                運営メンバーは platform_admins で管理しています。LINE でログインする場合は、各メンバーの権限者アカウントに LINE を紐づけてください。
              </p>
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={pending !== null}
        designWidth={480}
        designTop={300}
        tone={pending?.kind === 'resume' ? 'default' : 'destructive'}
        confirmation
        title={pending ? confirmTitle(pending) : ''}
        confirmLabel={pending?.kind === 'resume' ? '再開する' : pending?.kind === 'cancel' ? '取り消す' : '停止する'}
        busy={busy}
        error={error}
        designNode={pending?.kind === 'stop' ? 'VUyYu' : undefined}
        onConfirm={() => applyPending()}
        onCancel={() => { if (!busy) { pendingRef.current = null; setPending(null) } }}
      >
        <div className={parts.dialogBody}>
          <OperationTargetSummary accounts={[{ id: '', name: '不明' }]} externalTarget={{ label: '対象者', name: pending ? `${pending.member.name}（1人）` : '不明' }} />
          <Notice tone="info">
            {pending?.kind === 'resume'
              ? '再開すると、この人はまた運営コンソールに入れるようになります。'
              : pending?.kind === 'cancel'
                ? '取り消すと、届いた招待メールのリンクから入れなくなります。あとで再開できます。'
                : '停止すると、この人は運営コンソールに入れなくなります。あとで再開できます。'}
          </Notice>
        </div>
      </Dialog>
    </PageFrame>
  )
}

function confirmTitle(pending: PendingAction): string {
  const name = pending.member.name
  if (pending.kind === 'resume') return `${name} を再開しますか？`
  if (pending.kind === 'cancel') return `${name} への招待を取り消しますか？`
  return `${name} を停止しますか？`
}

/** 短い日時（10/2 07:10 の形）。 */
function shortDateTime(value: string | null): string {
  return polishFormatDate(value, { style: 'list', fallback: '—' })
}

function totpChip(m: OpsMember) {
  if (m.totpEnabled) return <StatusBadge tone="success">設定済み</StatusBadge>
  if (m.activationState === 'awaiting_totp' || m.activationState === 'invited') return <StatusBadge tone="info">二段階認証待ち</StatusBadge>
  return <StatusBadge tone="danger">未設定</StatusBadge>
}

/** 状態の札。停止 → 招待中 → 有効 の順に見る。 */
function stateChip(m: OpsMember) {
  if (!m.isActive) return <StatusBadge tone="neutral">停止</StatusBadge>
  if (m.activationState !== 'active') return <StatusBadge tone="info">招待中</StatusBadge>
  return <StatusBadge tone="success">有効</StatusBadge>
}
