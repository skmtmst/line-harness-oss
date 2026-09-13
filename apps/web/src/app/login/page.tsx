'use client'

import { MessageCircle } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import AuthCard, { AuthField } from '@/components/auth/auth-card'
import PasswordField from '@/components/auth/password-field'
import Button from '@/components/shared/button'
import { TextField } from '@/components/shared/text-field'
import { storeAdminSession } from '@/lib/admin-session'
import { authRequest, emailError } from '@/lib/auth-email'
import { AUTH_SELECTION_CLEARED_KEY } from '@/lib/hq-navigation'

/**
 * ログイン。★V6 0-1（`UufG8`、カード `m3tWJ`）。
 *
 * メール＋パスワードが主、LINE ログインが副（決定 2026-09-13）。
 * 既存の権限者は今までどおり LINE で入れる。二段階認証を有効にしている人は
 * パスワードのあとに既存の 6 桁コードの画面へ。
 */
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailMessage, setEmailMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<'password' | 'line' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const errorCode = new URLSearchParams(window.location.search).get('error')
    if (errorCode === 'not_authorized') {
      setError('このLINEアカウントには管理者権限がありません。オーナーに追加を依頼してください。')
    } else if (errorCode) {
      setError('LINEログインを完了できませんでした。もう一度お試しください。')
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const emailProblem = emailError(email)
    setEmailMessage(emailProblem)
    if (emailProblem) return
    if (!password) {
      setError('パスワードを入力してください')
      return
    }
    setBusy('password')
    setError('')
    const res = await authRequest<{ twoFactor: boolean; challengeToken?: string; sessionToken?: string }>('/api/auth/password/login', {
      email: email.trim(),
      password,
    })
    if (!res.ok || !res.data) {
      setError(res.error || 'ログインできませんでした')
      setBusy(null)
      return
    }
    sessionStorage.removeItem(AUTH_SELECTION_CLEARED_KEY)
    if (res.data.twoFactor && res.data.challengeToken) {
      window.location.assign(`/login/two-factor#${new URLSearchParams({ lh_2fa: res.data.challengeToken }).toString()}`)
      return
    }
    if (res.data.sessionToken) storeAdminSession(res.data.sessionToken, res.csrfToken)
    else if (res.csrfToken) localStorage.setItem('lh_csrf', res.csrfToken)
    window.location.assign('/')
  }

  const lineLogin = () => {
    setBusy('line')
    sessionStorage.removeItem(AUTH_SELECTION_CLEARED_KEY)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    if (!apiUrl) return setBusy(null)
    window.location.assign(`${apiUrl}/api/auth/line`)
  }

  return (
    <AuthCard
      node="UufG8"
      cardNode="m3tWJ"
      title="ログイン"
      description="メールアドレスとパスワードでログインします。LINE で登録した権限者は LINE でログインしてください。"
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex w-full flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-control bg-status-danger-soft px-4 py-3 text-label text-status-danger">
            {error}
          </p>
        ) : null}
        <AuthField label="メールアドレス" htmlFor="login-email" error={emailMessage}>
          <TextField
            id="login-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            invalid={Boolean(emailMessage)}
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            aria-describedby={emailMessage ? 'login-email-error' : undefined}
          />
        </AuthField>
        <AuthField label="パスワード" htmlFor="login-password">
          <PasswordField id="login-password" value={password} onChange={setPassword} autoComplete="current-password" />
        </AuthField>
        <div className="flex justify-end">
          <Link href="/password/forgot" className="text-caption font-semibold text-accent-deep hover:underline">
            パスワードを忘れた方はこちら
          </Link>
        </div>
        <Button type="submit" variant="primary" disabled={busy !== null} className="w-full">
          {busy === 'password' ? 'ログインしています…' : 'ログイン'}
        </Button>
      </form>

      <div className="flex w-full items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-hairline" />
        <span className="text-caption text-ink-faint">または</span>
        <span className="h-px flex-1 bg-hairline" />
      </div>

      <Button onClick={lineLogin} disabled={busy !== null} className="w-full">
        <MessageCircle aria-hidden="true" className="h-4.5 w-4.5 text-line-choice" />
        {busy === 'line' ? 'LINEへ移動中…' : 'LINE でログイン'}
      </Button>

      <p className="text-caption text-ink-faint">
        はじめての方は{' '}
        <Link href="/register" className="font-semibold text-accent-deep hover:underline">
          無料で始める
        </Link>
      </p>
    </AuthCard>
  )
}
