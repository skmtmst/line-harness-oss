'use client'

/*
 * ★V8 統括のメンバー（Pencil `r4ARpV`。招待の窓 `yLKwV`・権限を変える窓 `BHEl9`・
 * 変える前の確認 `M4jS9`）。
 *
 * v7 の画面（app/hq/members/page.tsx）と読み書きの口・権限・失敗時の扱いは同じ。
 * 見た目だけを絵どおりに一から組んだ：頭（型 ListPage）・左の「統括の設定」の列
 * （型のフォルダの列）・数のカード4枚・権限者の表・役割の説明。
 */
import { Plus } from 'lucide-react'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type { LineAccount, StaffMember } from '@line-crm/shared'
import { ListPage } from '@/components/templates'
import StepUpPrompt from '@/components/step-up-prompt'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { usePageTitle } from '@/components/shell/page-chrome'
import { describeApiFailure, japaneseDetailOf } from '@/components/shared/api-error-message'
import { api, ApiError } from '@/lib/api'
import { canResendInvite, lastLoginLabel, memberKpis, memberStatus, sortMembers, type MemberStatus } from '@/lib/hq-members'
import HqSettingsNavV8 from './settings-nav'
import MemberDialogV8, { MemberChangeConfirmV8, type MemberDialogValue } from './member-dialog'
import styles from './members.module.css'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/** 絵の言葉（役割）。担当範囲のアカウントだけを触る人は「担当者」。 */
const ROLE_WORDS: Record<StaffMember['role'], string> = {
  owner: 'オーナー',
  admin: '管理者',
  staff: '担当者',
  viewer: '閲覧のみ',
}

/** 絵の言葉（状態）。止めた人は「停止中」。 */
const STATUS_WORDS: Record<MemberStatus, string> = {
  active: '有効',
  invited: '招待中',
  expired: '期限切れ',
  inactive: '停止中',
}

const VIEWER_NOTE = '閲覧のみで見ています。権限者の招待・変更はオーナーか管理者に頼んでください。'

export default function HqMembersV8() {
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
  const [dialogSession, setDialogSession] = useState(0)
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
  const kpis = useMemo(() => memberKpis(members), [members])
  const canManage = me?.role === 'owner' || me?.role === 'admin'
  const restricted = me?.accountScope === 'accounts'

  const submitDialog = async (value: MemberDialogValue, stepUpToken?: string) => {
    setDialogBusy(true)
    setDialogError('')
    try {
      if (dialog.member) {
        const res = await api.staff.update(dialog.member.id, {
          /* 役割は変えたときだけ送る（担当者のまま保存しても管理者へ上がらない）。 */
          ...(value.role !== dialog.member.role ? { role: value.role } : {}),
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

  const openInvite = () => { setDialogError(''); setDialogSession((n) => n + 1); setDialog({ open: true, member: null }) }
  const openChange = (member: StaffMember) => { setDialogError(''); setDialogSession((n) => n + 1); setDialog({ open: true, member }) }
  const ready = status === 'ready' && !restricted

  return (
    <ListPage
      boardId="r4ARpV"
      title="メンバー"
      description="統括の画面に入れる人です。役割と、見られるアカウント（担当範囲）を決めます。"
      actions={ready && canManage ? (
        <Button variant="primary" onClick={openInvite}>
          <Plus aria-hidden="true" className={styles.buttonIcon} />
          権限者を招待
        </Button>
      ) : undefined}
      folders={<HqSettingsNavV8 active="members" />}
    >
      <div className={styles.body}>
        {ready && !canManage ? <p className={styles.viewerBand} role="status">{VIEWER_NOTE}</p> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        {actionError ? <p className={styles.error} role="alert">{actionError}</p> : null}

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
            <div className={styles.cards} aria-label="権限者の数">
              <StatCard label="権限者" value={kpis.total} unit="人" sub={`有効 ${kpis.active}人`} />
              <StatCard label="招待中" value={kpis.invited} unit="人" sub="まだ承諾していない招待" />
              <StatCard label="閲覧のみ" value={kpis.viewers} unit="人" sub="編集できない権限者" />
              <StatCard label="担当アカウント" value={kpis.scopedAccounts} unit="アカウント" sub={`全アカウントを担当 ${kpis.allScope}人`} />
            </div>

            <div className={styles.table} role="table" aria-label="権限者の一覧" data-design="Table">
              <div className={styles.head} role="row">
                <span role="columnheader">名前</span>
                <span role="columnheader">メールアドレス</span>
                <span role="columnheader">役割</span>
                <span role="columnheader">担当範囲</span>
                <span role="columnheader">状態</span>
                <span role="columnheader">最終ログイン</span>
                <span role="columnheader" className={styles.srOnly}>操作</span>
              </div>
              {rows.map((member) => {
                const state = memberStatus(member)
                const isSelf = member.id === me?.id
                const scope = member.accountScope !== 'accounts'
                  ? 'すべて'
                  : (member.scopedLineAccountIds ?? []).map((id) => accountNames.get(id) ?? '不明なアカウント').join('、') || 'アカウントなし'
                return (
                  <div key={member.id} className={styles.row} role="row">
                    <span role="cell" className={styles.cell} title={member.name}>{member.name}{isSelf ? '（あなた）' : ''}</span>
                    <span role="cell" className={styles.cell} title={member.email ?? ''}>{member.email ?? '—'}</span>
                    <span role="cell" className={styles.cell}>{ROLE_WORDS[member.role] ?? member.role}</span>
                    <span role="cell" className={styles.cell} title={scope}>{scope}</span>
                    <span role="cell"><span className={state === 'active' ? `${styles.pill} ${styles.pillOk}` : state === 'invited' ? `${styles.pill} ${styles.pillInfo}` : state === 'expired' ? `${styles.pill} ${styles.pillDanger}` : `${styles.pill} ${styles.pillIdle}`}><span className={styles.dot} aria-hidden="true" />{STATUS_WORDS[state]}</span></span>
                    <span role="cell" className={styles.cell}>{lastLoginLabel(lastLogins[member.id])}</span>
                    <span role="cell" className={styles.actions}>
                      {canManage && canResendInvite(member) ? (
                        <button
                          type="button"
                          className={styles.textButton}
                          disabled={resendingId === member.id}
                          onClick={() => void resend(member)}
                        >
                          {resendingId === member.id ? '送信中…' : '再送'}
                        </button>
                      ) : null}
                      {canManage ? (
                        <Button onClick={() => openChange(member)} aria-label={`${member.name}さんの権限を変更`}>変更</Button>
                      ) : null}
                    </span>
                  </div>
                )
              })}
            </div>

            <p className={styles.legend}>役割：オーナー（請求・メンバーまで全部）／管理者／担当者（担当範囲のアカウントだけ）／閲覧のみ（見るだけ）</p>
          </>
        )}
      </div>

      <MemberDialogV8
        /* 確認（M4jS9）を出す間は閉じる。確認をやめたら入れた中身のまま戻る。 */
        open={dialog.open && !confirmChange}
        session={dialogSession}
        member={dialog.member}
        accounts={accounts}
        isSelf={dialog.member?.id === me?.id}
        busy={dialogBusy}
        error={dialogError}
        onSubmit={(value) => {
          if (dialog.member) setConfirmChange({ member: dialog.member, value })
          else void submitDialog(value)
        }}
        onCancel={() => {
          if (dialogBusy) return
          setDialog({ open: false, member: null })
        }}
      />
      {confirmChange ? (
        <MemberChangeConfirmV8
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
    </ListPage>
  )
}

/** 数のカード（絵 `r4ARpV` の数の帯。統括では角丸のカード4枚）。 */
function StatCard({ label, value, unit, sub }: { label: string; value: number; unit: string; sub: string }) {
  return (
    <div className={styles.card}>
      <span className={styles.cardLabel}>{label}</span>
      <span className={styles.cardValueRow}>
        <span className={styles.cardValue}>{value.toLocaleString('ja-JP')}</span>
        <span className={styles.cardUnit}>{unit}</span>
      </span>
      <span className={styles.cardSub}>{sub}</span>
    </div>
  )
}
