'use client'

import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type OpsMember, type OpsMemberSummary } from '@/lib/api'
import OpsPageHeader from '@/components/ops/ops-page-header'
import { formatDateTime, opsCall } from '@/components/ops/ops-ui'
import NoticeLineAccountCard from '@/components/ops/notice-line-account-card'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SummaryCard from '@/components/shared/summary-card'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import { TextField } from '@/components/shared/text-field'

/** メンバー管理。★V6 37-10 `POteo`。左下のアカウントメニューから入る。 */

/** 状態の札。停止 → 招待中 → 2要素認証待ち → 有効 の順に見る。 */
function memberStateChip(m: OpsMember) {
  if (!m.isActive) return <Chip tone="neutral">停止</Chip>
  if (m.activationState === 'invited') return <Chip tone="warn">招待中</Chip>
  if (m.activationState === 'awaiting_totp') return <Chip tone="info">2要素認証待ち</Chip>
  return <Chip tone="ok">有効</Chip>
}

export default function OpsMembersPage() {
  const [members, setMembers] = useState<OpsMember[]>([])
  const [summary, setSummary] = useState<OpsMemberSummary | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<'members' | 'info'>('members')
  const [inviting, setInviting] = useState(false)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [me, setMe] = useState<string | null>(null)
  const [toggling, setToggling] = useState<OpsMember | null>(null)
  const [notice, setNotice] = useState('')
  const [resendingId, setResendingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError('')
    // fetchApi は 4xx/5xx を例外にするので、両方とも opsCall で受ける。
    // 生の Promise.all だと片方の拒否で load ごと落ち、「読み込んでいます」のまま固まる。
    const [res, meRes] = await Promise.all([opsCall(api.ops.members()), opsCall(api.ops.me())])
    setLoaded(true)
    if (!res.success) { setError(res.error || '読み込めませんでした'); return }
    setMembers(res.data)
    setSummary(res.summary)
    if (meRes.success) setMe(meRes.data.id)
  }, [])

  useEffect(() => { void load() }, [load])

  const invite = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const res = await opsCall(api.ops.addMember({ email: email.trim() }))
    setBusy(false)
    if (!res.success) { setError(res.error || '招待できませんでした'); return }
    setNotice(res.data.activationState === 'active'
      ? '最初の運営メンバーとして登録しました'
      : `${email.trim()} に招待メールを送りました。相手が2要素認証の登録を終えると運営メンバーになります`)
    setEmail('')
    setInviting(false)
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

  const toggle = async () => {
    if (!toggling) return
    setBusy(true)
    setError('')
    const res = await opsCall(api.ops.setMemberActive(toggling.staffId, !toggling.isActive))
    setBusy(false)
    if (!res.success) { setError(res.error || '変更できませんでした'); return }
    setToggling(null)
    void load()
  }

  const totpMissing = summary ? summary.members - summary.totpEnabled : 0

  return (
    <div data-design-node="POteo">
      <OpsPageHeader title="メンバー管理" />
      <div className="mb-4">
        <Tabs
          items={[
            { label: '権限者', current: tab === 'members', onClick: () => setTab('members') },
            { label: '運営の情報', current: tab === 'info', onClick: () => setTab('info') },
          ]}
          actions={
            tab === 'members' ? (
              <Button variant="primary" onClick={() => setInviting((v) => !v)}>
                <Plus aria-hidden="true" className="h-4 w-4" />
                運営メンバーを招待
              </Button>
            ) : undefined
          }
        />
      </div>

      {inviting ? (
        <form onSubmit={(event) => void invite(event)} className="mb-4 flex items-center gap-2 rounded-card border border-hairline bg-canvas px-4 py-3">
          <div className="flex-1">
            <TextField
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="招待する人のメールアドレス"
              aria-label="メールアドレス"
              required
            />
          </div>
          <Button type="submit" variant="primary" disabled={busy}>招待メールを送る</Button>
          <Button onClick={() => setInviting(false)}>やめる</Button>
        </form>
      ) : null}

      <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard variant="v6" title="運営メンバー" value={summary ? summary.members : null} unit="人" detail={summary ? `招待中 ${summary.invited}・2要素認証待ち ${summary.awaitingTotp}` : '—'} loading={!loaded} />
        <SummaryCard variant="v6" title="2要素認証" value={summary ? summary.totpEnabled : null} unit={summary ? `/ ${summary.members}人` : '人'} detail={totpMissing > 0 ? `未設定 ${totpMissing}人` : '全員設定済み'} badge={totpMissing > 0 ? '要対応' : undefined} badgeTone="danger" loading={!loaded} />
        <SummaryCard variant="v6" title="今月の代理ログイン" value={summary ? summary.impersonationsThisMonth : null} unit="回" detail={summary ? `書き込み ${summary.writeImpersonationsThisMonth}回` : '—'} loading={!loaded} />
        <SummaryCard variant="v6" title="今月の個人情報の表示" value={summary ? summary.piiRevealsThisMonth : null} unit="回" detail="理由の記録あり" loading={!loaded} />
      </div>

      <div className="mb-4">
        <NoteBar tone="warn">運営メンバーはメールで招待します。招待された人はパスワードを設定し、2要素認証の登録が終わるまで運営コンソールに入れません。自分自身は変えられません。</NoteBar>
      </div>

      {notice ? <p role="status" className="mb-3 text-caption text-accent-deep">{notice}</p> : null}
      {error ? <p role="alert" className="mb-3 text-caption text-status-danger">{error}</p> : null}

      {tab === 'members' ? (
        !loaded ? (
          <ListState kind="loading" title="運営メンバーを読み込んでいます" />
        ) : error && members.length === 0 ? (
          <ListState kind="error" title="運営メンバーを表示できませんでした" onRetry={() => void load()} />
        ) : members.length === 0 ? (
          <ListState kind="empty" title="運営メンバーがいません" description="最初の 1 人は、自分のメールアドレスを「運営メンバーを招待」に入れて登録します。" />
        ) : (
          <DataTable>
            <thead>
              <TableHeadRow>
                {/*
                  ★V7: 操作列は入る幅で固定する（「再送」「停止」の2つ＋送信中の表示）。
                  1440px で合計が枠に収まるよう、メール・最終ログインは詰める（1行省略＋全文は title）。
                */}
                <Th className="w-72">名前</Th>
                <Th className="w-52">メール</Th>
                <Th className="w-36">2要素認証</Th>
                <Th className="w-28">状態</Th>
                <Th className="w-36">最終ログイン</Th>
                <Th className="w-48" align="right">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {members.map((m) => (
                <Tr key={m.staffId}>
                  <Td><span className="block truncate text-label font-bold text-ink" title={m.name}>{m.name}{m.staffId === me ? '（あなた）' : ''}</span></Td>
                  <Td><span className="block truncate text-caption text-ink-secondary" title={m.email ?? ''}>{m.email ?? '—'}</span></Td>
                  <Td>{m.totpEnabled ? <Chip tone="ok">設定済み</Chip> : <Chip tone="danger">未設定</Chip>}</Td>
                  <Td>{memberStateChip(m)}</Td>
                  <Td><span className="text-caption text-ink-secondary">{formatDateTime(m.lastLoginAt)}</span></Td>
                  <Td align="right">
                    {m.staffId === me ? null : (
                      <span className="inline-flex gap-2">
                        {m.isActive && m.activationState !== 'active' ? (
                          <Button size="field" onClick={() => void resend(m)} disabled={resendingId !== null}>
                            {resendingId === m.staffId ? '送信中…' : '再送'}
                          </Button>
                        ) : null}
                        <Button size="field" onClick={() => setToggling(m)} disabled={busy}>
                          {m.isActive ? '停止' : '再開'}
                        </Button>
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )
      ) : (
        <div className="grid gap-4">
          <NoticeLineAccountCard />
          <div className="rounded-card border border-hairline bg-canvas px-5 py-4 text-label text-ink-secondary">
            運営メンバーは <code className="rounded bg-canvas-sunken px-1">platform_admins</code> で管理しています。
            LINE でログインする場合は、各メンバーの権限者アカウントに LINE を紐づけてください。
          </div>
        </div>
      )}

      <ConfirmDialog
        open={toggling !== null}
        title={toggling ? `${toggling.name} を${toggling.isActive ? '停止' : '再開'}しますか？` : ''}
        description={toggling?.isActive
          ? '停止すると、この人は運営コンソールに入れなくなります。権限者としての登録は残ります。'
          : '再開すると、この人はまた運営コンソールに入れるようになります。'}
        confirmLabel={toggling?.isActive ? '停止する' : '再開する'}
        destructive={Boolean(toggling?.isActive)}
        busy={busy}
        error={error}
        onConfirm={() => void toggle()}
        onCancel={() => { if (!busy) setToggling(null) }}
      />
    </div>
  )
}
