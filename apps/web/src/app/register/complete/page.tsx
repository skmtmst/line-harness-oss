'use client'

import { Check } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState, type FormEvent } from 'react'
import AuthCard, { AuthField } from '@/components/auth/auth-card'
import PasswordField from '@/components/auth/password-field'
import PasswordRequirements from '@/components/auth/password-requirements'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { storeAdminSession, twoFactorChallengeHandoffPath } from '@/lib/admin-session'
import { authRequest, confirmError, CONTACT_URL, internalAuthFailureCopy, passwordError, readDeviceMarker, storeDeviceMarker } from '@/lib/auth-email'
import { resetAuthSelectionCleared } from '@/lib/hq-navigation'
import styles from './complete.module.css'

/**
 * 会員登録の本登録。★管理画面 36-4-B（`jk88n`、カード `oVX3x`）。
 *
 * 承認メールの URL（`?token=`）から開く。申込済み会社名・担当者名を確認してパスワードを入れると
 * 統括（トライアル 30 日）とオーナー権限者を作り、二段階認証の設定へ進む。
 */
export default function RegisterCompletePage() {
  return (
    <Suspense fallback={<CompletePending />}>
      <CompleteInner />
    </Suspense>
  )
}

function CompletePending() {
  return (
    <AuthCard node="jk88n" cardNode="oVX3x" title="本登録" description="URL を確かめています">
      <ListState kind="loading" title="URL を確かめています" />
    </AuthCard>
  )
}

type TokenCheck = { state: 'checking' } | { state: 'ok'; email: string; trialDays: number; companyName: string; contactName: string } | { state: 'pending' } | { state: 'bad'; message: string }

function CompleteInner() {
  const params = useSearchParams()
  const token = params.get('token') ?? ''
  const [check, setCheck] = useState<TokenCheck>({ state: 'checking' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [messages, setMessages] = useState<Record<string, string | null>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    if (!token) {
      setCheck({ state: 'bad', message: 'この URL は正しくありません。メールの URL をそのまま開いてください' })
      return
    }
    void authRequest<{ email: string; trialDays: number; companyName: string; contactName: string }>(`/api/auth/register/check?token=${encodeURIComponent(token)}`).then((res) => {
      if (!alive) return
      if (res.ok && res.data) setCheck({ state: 'ok', email: res.data.email, trialDays: res.data.trialDays, companyName: res.data.companyName, contactName: res.data.contactName })
      else if (res.code === 'approval_required') setCheck({ state: 'pending' })
      else setCheck({ state: 'bad', message: res.error || 'この URL は使えません' })
    })
    return () => {
      alive = false
    }
  }, [token])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const next: Record<string, string | null> = {
      password: passwordError(password),
      confirm: confirmError(password, confirm),
    }
    setMessages(next)
    if (Object.values(next).some(Boolean)) return
    setBusy(true)
    setError('')
    const res = await authRequest<{ tenantId: string; deviceMarker: string; sessionToken?: string; twoFactorSetup?: boolean; challengeToken?: string }>('/api/auth/register/complete', {
      token,
      password,
      deviceMarker: readDeviceMarker(),
    })
    if (!res.ok || !res.data) {
      if (res.errors) setMessages((current) => ({ ...current, ...res.errors }))
      setError(internalAuthFailureCopy(res.status, res.error) ?? res.error ?? '登録を完了できませんでした。時間をおいて、もう一度お試しください。')
      setBusy(false)
      return
    }
    storeDeviceMarker(res.data.deviceMarker)
    resetAuthSelectionCleared(localStorage, sessionStorage)
    // オーナーは二段階認証が必須（N-426）。設定画面へ進み、完了後にセッションが出る。
    if (res.data.twoFactorSetup && res.data.challengeToken) {
      window.location.assign(twoFactorChallengeHandoffPath('/login/two-factor/setup', res.data.challengeToken))
      return
    }
    if (res.data.sessionToken) storeAdminSession(res.data.sessionToken, res.csrfToken)
    else if (res.csrfToken) {
      // M045: 保存に失敗しても登録は進める（Cookie のセッションで足りる）。
      // 投げたままにすると登録中の表示で止まる。
      try { localStorage.setItem('lh_csrf', res.csrfToken) } catch { /* Cookie session is sufficient */ }
    }
    window.location.assign('/hq')
  }

  if (check.state === 'checking') return <CompletePending />
  if (check.state === 'bad') {
    return (
      <AuthCard node="jk88n" cardNode="oVX3x" title="本登録" description={check.message}>
        <Button href="/register" variant="primary" className="w-full">
          もう一度メールアドレスを入力する
        </Button>
        <Button href="/login" className="w-full">
          ログインへ
        </Button>
      </AuthCard>
    )
  }
  if (check.state === 'pending') {
    return <AuthCard node="VA42o" applicationFlow="pending" title="お申し込みを確認中です"
      description="担当者からご連絡します。承認のご案内が届くまで、musuboへのログインはできません。">
      <div className={styles.pendingNext}>
        <strong>次に行うこと</strong>
        お申し込み時のメールをご確認ください。担当者からの連絡がない場合はお問い合わせください。
      </div>
      <a href={CONTACT_URL} target="_blank" rel="noreferrer" className={styles.contact}>お問い合わせ</a>
      <a href="/login" className={styles.login}>ログイン画面に戻る</a>
    </AuthCard>
  }

  return (
    <AuthCard
      node="x73h3"
      applicationFlow="setup"
      title="利用開始の設定"
      description={`お申し込みが承認されました。設定を完了すると${check.trialDays}日間無料でmusuboを利用できます。`}
    >
      <div className={styles.approved}>✓ 承認済み　初期設定を完了してください</div>
      <form onSubmit={(event) => void submit(event)} noValidate className="flex w-full flex-col gap-4">
        {error ? (
          <Notice tone="danger" message={error} />
        ) : null}
        <ConfirmedField label="メールアドレス" id="complete-email" value={check.email} />
        <ConfirmedField label="会社名" id="complete-tenant" value={check.companyName} />
        <ConfirmedField label="担当者名" id="complete-name" value={check.contactName} />
        <AuthField label="パスワード" htmlFor="complete-password" error={messages.password}>
          <PasswordField id="complete-password" value={password} onChange={setPassword} invalid={Boolean(messages.password)} autoComplete="new-password" placeholder="新しいパスワードを入力" />
          <PasswordRequirements value={password} />
        </AuthField>
        <AuthField label="パスワード（確認）" htmlFor="complete-confirm" error={messages.confirm}>
          <PasswordField id="complete-confirm" value={confirm} onChange={setConfirm} invalid={Boolean(messages.confirm)} autoComplete="new-password" />
        </AuthField>
        <Button type="submit" variant="primary" disabled={busy} className="w-full" busy={busy} busyLabel="設定しています…">設定を完了してmusuboを始める
        </Button>
      </form>
    </AuthCard>
  )
}

function ConfirmedField({ label, id, value }: { label: string; id: string; value: string }) {
  return <AuthField label={label} htmlFor={id}>
    <output id={id} className="flex h-11 w-full items-center justify-between rounded-control border border-hairline bg-surface-pearl px-3 text-label text-ink-secondary">
      <span className="truncate">{value}</span>
      <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-accent-deep" />
    </output>
  </AuthField>
}
