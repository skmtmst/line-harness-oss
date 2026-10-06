'use client'

import { Eye, LogIn, Send, Users } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type OpsMember, type OpsMemberSummary } from '@/lib/api'
import { formatDateTime, opsCall } from '@/components/ops/ops-ui'
import { opsEnvironmentLabel } from '@/components/ops/ops-env-bar'
import NoticeLineAccountCard from '@/components/ops/notice-line-account-card'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import KpiCard from '@/components/shared/kpi-card'
import kpiStyles from '@/components/shared/kpi-card.module.css'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import { Tabs } from '@/components/shared/tabs'
import { TextField } from '@/components/shared/text-field'
import { OpsHead } from './shell'
import parts from './parts.module.css'
import styles from './members.module.css'

/**
 * 運営のメンバー管理 V8（絵 `FvbHW`・停止の窓 `VUyYu`）。
 *
 * 動きは v7（app/ops/members）と同じ口：一覧（/api/ops/members）・招待・再送・
 * 停止／再開。自分自身の行には操作を置かない。閲覧のみの運営メンバー
 * （/api/ops/me の readOnly）には、招待・停止などの押せないボタンを置かない。
 */

type PendingAction = { member: OpsMember; kind: 'stop' | 'resume' | 'cancel' }

export default function OpsMembersV8() {
  const [members, setMembers] = useState<OpsMember[]>([])
  const [summary, setSummary] = useState<OpsMemberSummary | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<'members' | 'info'>('members')
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

  const invite = async (event: FormEvent) => {
    event.preventDefault()
    if (!email.trim()) { setError('招待する人のメールアドレスを入れてください'); return }
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

  const confirm = async () => {
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
    <div data-design-node="FvbHW">
      <OpsHead
        title="メンバー管理"
        description="運営メンバーはメールで招待します。招待された人はパスワードを設定し、2要素認証の登録が終わるまで運営コンソールに入れません。自分自身は変えられません。"
        environment={opsEnvironmentLabel(process.env.NEXT_PUBLIC_API_URL)}
      />
      <div className={parts.stack}>
        <div className={styles.tabs}>
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
            <div className={`${parts.kpis} ${styles.kpis3} ${kpiStyles.strip}`}>
              <KpiCard presentation="cell" icon={<Users size={13} aria-hidden="true" />} title="運営メンバー" value={summary ? summary.members : null} unit="人" detail={summary ? `有効 ${active}・招待中 ${summary.invited}` : '—'} loading={!loaded} />
              <KpiCard presentation="cell" icon={<LogIn size={13} aria-hidden="true" />} title="今月の代理ログイン" value={summary ? summary.impersonationsThisMonth : null} unit="回" detail="監査ログに記録" loading={!loaded} />
              <KpiCard presentation="cell" icon={<Eye size={13} aria-hidden="true" />} title="今月の個人情報の表示" value={summary ? summary.piiRevealsThisMonth : null} unit="回" detail="監査ログに記録" loading={!loaded} />
            </div>

            {readOnly ? null : (
              <form onSubmit={(event) => void invite(event)} className={styles.invite}>
                <div className={styles.inviteField}>
                  <TextField
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="招待する人のメールアドレス"
                    aria-label="招待する人のメールアドレス"
                    autoComplete="off"
                  />
                </div>
                <Button type="submit" variant="primary" disabled={busy}>
                  <Send aria-hidden="true" />招待メールを送る
                </Button>
              </form>
            )}

            {notice ? <p role="status" className={parts.status}>{notice}</p> : null}
            {error && !listFailed ? <p role="alert" className={parts.alert}>{error}</p> : null}

            {!loaded ? (
              <ListState kind="loading" title="運営メンバーを読み込んでいます" />
            ) : listFailed ? (
              <div className={parts.panel}>
                <ListState kind="error" title="運営メンバーを表示できませんでした" description={error} onRetry={() => void load()} />
              </div>
            ) : members.length === 0 ? (
              <div className={parts.panel}>
                <ListState kind="empty" title="運営メンバーがいません" description="最初の 1 人は、自分のメールアドレスを入れて「招待メールを送る」を押して登録します。" />
              </div>
            ) : (
              <div className={parts.mini} role="table" aria-label="運営メンバー">
                <div className={parts.miniHead} role="row">
                  <span className={parts.grow} role="columnheader">名前</span>
                  <span className={`${parts.fixed} ${styles.colMail}`} role="columnheader">メール</span>
                  <span className={`${parts.fixed} ${styles.colTotp}`} role="columnheader">2要素認証</span>
                  <span className={`${parts.fixed} ${styles.colState}`} role="columnheader">状態</span>
                  <span className={`${parts.fixed} ${styles.colLogin}`} role="columnheader">最終ログイン</span>
                  <span className={`${parts.fixed} ${styles.colOps}`} role="columnheader">操作</span>
                </div>
                {members.map((m) => {
                  const self = m.staffId === me
                  const invited = m.isActive && m.activationState !== 'active'
                  return (
                    <div key={m.staffId} className={`${parts.miniRow} ${self ? styles.selfRow : styles.memberRow}`} role="row">
                      <span className={parts.grow} role="cell" title={m.name}>{m.name}{self ? '（自分）' : ''}</span>
                      <span className={`${parts.fixed} ${styles.colMail}`} role="cell" title={m.email ?? ''}>{m.email ?? '—'}</span>
                      <span className={`${parts.fixed} ${styles.colTotp}`} role="cell">{totpChip(m)}</span>
                      <span className={`${parts.fixed} ${styles.colState}`} role="cell">{stateChip(m)}</span>
                      <span className={`${parts.fixed} ${styles.colLogin} ${m.lastLoginAt ? '' : styles.faint}`} role="cell">{shortDateTime(m.lastLoginAt)}</span>
                      <span className={`${styles.colOps} ${styles.ops}`} role="cell">
                        {self || readOnly ? (
                          <span className={styles.faint}>—</span>
                        ) : invited ? (
                          <>
                            <Button onClick={() => setPending({ member: m, kind: 'cancel' })} disabled={busy}>取り消す</Button>
                            <Button onClick={() => void resend(m)} disabled={resendingId !== null} busy={resendingId === m.staffId} busyLabel="送信中…">再送</Button>
                          </>
                        ) : (
                          <Button onClick={() => setPending({ member: m, kind: m.isActive ? 'stop' : 'resume' })} disabled={busy}>
                            {m.isActive ? '停止' : '再開'}
                          </Button>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
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
        onConfirm={() => void confirm()}
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
    </div>
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
  if (!value) return '—'
  const full = formatDateTime(value)
  const m = full.match(/^(\d+)-(\d+)-(\d+) (\d+:\d+)$/)
  if (!m) return full
  return `${Number(m[2])}/${Number(m[3])} ${m[4]}`
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
