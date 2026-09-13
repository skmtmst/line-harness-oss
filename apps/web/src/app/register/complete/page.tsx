'use client'

import { Check } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState, type FormEvent } from 'react'
import AuthCard, { AuthField } from '@/components/auth/auth-card'
import PasswordField from '@/components/auth/password-field'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { TextField } from '@/components/shared/text-field'
import { storeAdminSession } from '@/lib/admin-session'
import { authRequest, confirmError, passwordError, readDeviceMarker, storeDeviceMarker } from '@/lib/auth-email'
import { AUTH_SELECTION_CLEARED_KEY } from '@/lib/hq-navigation'

/**
 * 会員登録の本登録。★V6 36-4-B（`jk88n`、カード `oVX3x`）。
 *
 * メールの URL（`?token=`）から開く。会社名・名前・パスワードを入れると
 * 統括（トライアル 30 日）とオーナー権限者ができ、そのまま統括の画面へ。
 */
export default function RegisterCompletePage() {
  return (
    <Suspense fallback={null}>
      <CompleteInner />
    </Suspense>
  )
}

type TokenCheck = { state: 'checking' } | { state: 'ok'; email: string; trialDays: number } | { state: 'bad'; message: string }

function CompleteInner() {
  const params = useSearchParams()
  const token = params.get('token') ?? ''
  const [check, setCheck] = useState<TokenCheck>({ state: 'checking' })
  const [tenantName, setTenantName] = useState('')
  const [name, setName] = useState('')
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
    void authRequest<{ email: string; trialDays: number }>(`/api/auth/register/check?token=${encodeURIComponent(token)}`).then((res) => {
      if (!alive) return
      if (res.ok && res.data) setCheck({ state: 'ok', email: res.data.email, trialDays: res.data.trialDays })
      else setCheck({ state: 'bad', message: res.error || 'この URL は使えません' })
    })
    return () => {
      alive = false
    }
  }, [token])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const next: Record<string, string | null> = {
      tenantName: tenantName.trim() ? null : '会社名・統括名を入力してください',
      name: name.trim() ? null : 'お名前を入力してください',
      password: passwordError(password),
      confirm: confirmError(password, confirm),
    }
    setMessages(next)
    if (Object.values(next).some(Boolean)) return
    setBusy(true)
    setError('')
    const res = await authRequest<{ tenantId: string; deviceMarker: string; sessionToken?: string }>('/api/auth/register/complete', {
      token,
      tenantName: tenantName.trim(),
      name: name.trim(),
      password,
      deviceMarker: readDeviceMarker(),
    })
    if (!res.ok || !res.data) {
      if (res.errors) setMessages((current) => ({ ...current, ...res.errors }))
      setError(res.error || '登録を完了できませんでした')
      setBusy(false)
      return
    }
    storeDeviceMarker(res.data.deviceMarker)
    sessionStorage.removeItem(AUTH_SELECTION_CLEARED_KEY)
    if (res.data.sessionToken) storeAdminSession(res.data.sessionToken, res.csrfToken)
    else if (res.csrfToken) localStorage.setItem('lh_csrf', res.csrfToken)
    window.location.assign('/hq')
  }

  if (check.state === 'checking') {
    return (
      <AuthCard node="jk88n" cardNode="oVX3x" title="本登録" description="URL を確かめています">
        <ListState kind="loading" title="URL を確かめています" />
      </AuthCard>
    )
  }
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

  return (
    <AuthCard
      node="jk88n"
      cardNode="oVX3x"
      title="本登録"
      description={`メールアドレスの確認ができました。会社名・お名前・パスワードを入れると登録が完了し、そのまま統括の画面に入れます（${check.trialDays}日間の無料トライアル）。`}
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex w-full flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-control bg-status-danger-soft px-4 py-3 text-label text-status-danger">
            {error}
          </p>
        ) : null}
        <AuthField label="メールアドレス" hint="確認済み・ここでは変えられません" htmlFor="complete-email">
          <div id="complete-email" className="flex h-11 w-full items-center justify-between rounded-control border border-hairline bg-surface-pearl px-3 text-label text-ink-secondary">
            <span className="truncate">{check.email}</span>
            <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-accent-deep" />
          </div>
        </AuthField>
        <AuthField label="会社名・統括名" hint="あとから変えられます" htmlFor="complete-tenant" error={messages.tenantName}>
          <TextField
            id="complete-tenant"
            value={tenantName}
            onChange={(event) => setTenantName(event.target.value)}
            invalid={Boolean(messages.tenantName)}
            autoComplete="organization"
            maxLength={80}
            placeholder="例：株式会社サンプル"
          />
        </AuthField>
        <AuthField label="あなたの名前" htmlFor="complete-name" error={messages.name}>
          <TextField
            id="complete-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            invalid={Boolean(messages.name)}
            autoComplete="name"
            maxLength={80}
            placeholder="例：山田 太郎"
          />
        </AuthField>
        <AuthField label="パスワード" hint="8文字以上・英字と数字" htmlFor="complete-password" error={messages.password}>
          <PasswordField id="complete-password" value={password} onChange={setPassword} invalid={Boolean(messages.password)} autoComplete="new-password" />
        </AuthField>
        <AuthField label="パスワード（確認）" htmlFor="complete-confirm" error={messages.confirm}>
          <PasswordField id="complete-confirm" value={confirm} onChange={setConfirm} invalid={Boolean(messages.confirm)} autoComplete="new-password" />
        </AuthField>
        <Button type="submit" variant="primary" disabled={busy} className="w-full">
          {busy ? '登録しています…' : '無料で始める'}
        </Button>
      </form>
    </AuthCard>
  )
}
