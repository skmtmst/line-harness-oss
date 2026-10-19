'use client'

import { requiredText } from '@/lib/form-requirement'
const inviteEmailRequirement = requiredText('招待する人のメールアドレスを入れてください')
import { useUrlTab } from '@/lib/use-url-tab'
import { Eye, LogIn, Send, Users } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type OpsMember, type OpsMemberSummary } from '@/lib/api'
import { opsCall } from '@/components/ops/ops-ui'
import { opsEnvironmentLabel } from '@/components/ops/ops-env-bar'
import NoticeLineAccountCard from '@/components/ops/notice-line-account-card'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import KpiCard from '@/components/shared/kpi-card'
import KpiBand from '@/components/shared/kpi-band'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import { Tabs } from '@/components/shared/tabs'
import { Field } from '@/components/shared/form-controls'
import { TextField } from '@/components/shared/text-field'
import { OpsHead } from './shell'
import { PageFrame } from '@/components/templates/page-frame'
import parts from './parts.module.css'
import styles from './members.module.css'
import { formatDate as polishFormatDate, formatDateTime } from '@/lib/format'
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
 * （/api/ops/me の readOnly）には、招待・停止などの押せないボタンを置かない。
 */

type PendingAction = { member: OpsMember; kind: 'stop' | 'resume' | 'cancel' }

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
  const [readOnly, setReadOnly] = useState(true)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [notice, setNotice] = useState('')
  const [resendingId, setResendingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError('')
    setListFailed(false)
    const [res, meRes] = await Promise.all([opsCall(api.ops.members()), opsCall(api.ops.me())])
    setLoaded(true)
    if (meRes.success) { setMe(meRes.data.id); setReadOnly(meRes.data.readOnly) }
    if (!res.success) { setError(res.error || '読み込めませんでした'); setListFailed(true); return }
    setMembers(res.data)
    setSummary(res.summary)
  }, [])

  useEffect(() => { void load() }, [load])

  const [inviteError, setInviteError] = useState<string | null>(null)
  const invite = async (event: FormEvent) => {
    event.preventDefault()
    const problem = inviteEmailRequirement.check(email)
    setInviteError(problem)
    if (problem) return
    setBusy(true)
    setError('')
    const res = await opsCall(api.ops.addMember({ email: email.trim() }))
    setBusy(false)
    if (!res.success) { setError(res.error || '招待できませんでした'); return }
    setNotice(res.data.activationState === 'active'
      ? '最初の運営メンバーとして登録しました'
      : `${email.trim()} に招待メールを送りました。相手が2要素認証の登録を終えると運営メンバーになります`)
    setEmail('')
    void load()
  }

  const resend = async (member: OpsMember) => {
    setResendingId(member.staffId)
    setError('')
    const res = await opsCall(api.ops.resendInvite(member.staffId))
    setResendingId(null)
    if (!res.success) { setError(res.error || '送り直せませんでした'); return }
    setNotice(`${member.email ?? member.name} に招待メールを送り直しました`)
    void load()
  }

  const applyPending = async () => {
    if (!pending) return
    setBusy(true)
    setError('')
    const res = await opsCall(api.ops.setMemberActive(pending.member.staffId, pending.kind === 'resume'))
    setBusy(false)
    if (!res.success) { setError(res.error || '変更できませんでした'); return }
    setPending(null)
    void load()
  }

  const active = summary ? summary.members - summary.invited : null

  return (
    <PageFrame kind="list" boardId="FvbHW" standalone skeleton>
      <OpsHead
        title="メンバー管理"
        description="運営メンバーはメールで招待します。招待された人はパスワードを設定し、2要素認証の登録が終わるまで運営コンソールに入れません。自分自身は変えられません。"
        environment={opsEnvironmentLabel(process.env.NEXT_PUBLIC_API_URL)}
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
              <KpiCard presentation="cell" icon={<Users size={13} aria-hidden="true" />} title="運営メンバー" value={summary ? summary.members : null} unit="人" detail={summary ? <span title={`2要素認証 設定済み ${summary.totpEnabled}人 / ${summary.members}人・未設定 ${Math.max(0, summary.members - summary.totpEnabled)}人`}>{`有効 ${active}・招待中 ${summary.invited}`}</span> : emptyValue('unknown')} loading={!loaded} />
              <KpiCard presentation="cell" icon={<LogIn size={13} aria-hidden="true" />} title="今月の代理ログイン" value={summary ? summary.impersonationsThisMonth : null} unit="回" detail="監査ログに記録" loading={!loaded} />
              <KpiCard presentation="cell" icon={<Eye size={13} aria-hidden="true" />} title="今月の個人情報の表示" value={summary ? summary.piiRevealsThisMonth : null} unit="回" detail="監査ログに記録" loading={!loaded} />
            </KpiBand>

            {readOnly ? null : (
              <form onSubmit={(event) => void invite(event)} className={styles.invite}>
                <div className={styles.inviteField}>
                  <Field label="招待する人のメールアドレス" requirement={inviteEmailRequirement} error={inviteError}><SaveErrorField names={["email"]}><TextField
                    type="email"
                    value={email}
                    onChange={(event) => { setEmail(event.target.value); setInviteError(null) }}
                    placeholder="招待する人のメールアドレス"
                    aria-label="招待する人のメールアドレス"
                    autoComplete="off"
                  /></SaveErrorField></Field>
                </div>
                <Button type="submit" variant="primary" disabled={busy}>
                  <Send aria-hidden="true" />招待メールを送る
                </Button>
              </form>
            )}

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
                  <GridCell role="columnheader">2要素認証</GridCell>
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
                        {readOnly ? null : self ? <RowActions subjectName={m.name} menuButtonProps={{ disabled: true, title: '自分の運営アカウントは停止・取り消しできません' }} menuNote="自分の運営アカウントは停止・取り消しできません" /> : <RowActions subjectName={m.name} menuButtonProps={{ disabled: busy || resendingId !== null }} menuItems={invited ? [
                          { id: 'resend', label: '招待を再送する', onSelect: () => { void resend(m) } },
                          { id: 'cancel', label: '取り消す', tone: 'danger', onSelect: () => setPending({ member: m, kind: 'cancel' }) },
                        ] : [{ id: 'state', label: m.isActive ? '停止する' : '再開する', tone: m.isActive ? 'danger' : undefined, onSelect: () => setPending({ member: m, kind: m.isActive ? 'stop' : 'resume' }) }]} />}
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
        onCancel={() => { if (!busy) setPending(null) }}
      >
        <div className={parts.dialogBody}>
        <p className={parts.dialogNote}>
          {pending?.kind === 'resume'
            ? '再開すると、この人はまた運営コンソールに入れるようになります。'
            : pending?.kind === 'cancel'
              ? '取り消すと、届いた招待メールのリンクから入れなくなります。あとで再開できます。'
              : '停止すると、この人は運営コンソールに入れなくなります。あとで再開できます。'}
        </p>
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
  if (m.activationState === 'awaiting_totp' || m.activationState === 'invited') return <StatusBadge tone="info">2要素認証待ち</StatusBadge>
  return <StatusBadge tone="danger">未設定</StatusBadge>
}

/** 状態の札。停止 → 招待中 → 有効 の順に見る。 */
function stateChip(m: OpsMember) {
  if (!m.isActive) return <StatusBadge tone="neutral">停止</StatusBadge>
  if (m.activationState !== 'active') return <StatusBadge tone="info">招待中</StatusBadge>
  return <StatusBadge tone="success">有効</StatusBadge>
}
