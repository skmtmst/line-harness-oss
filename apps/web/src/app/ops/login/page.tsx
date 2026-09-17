'use client'

import { MessageCircle } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import AuthCard, { AuthField } from '@/components/auth/auth-card'
import PasswordField from '@/components/auth/password-field'
import Button from '@/components/shared/button'
import { TextField } from '@/components/shared/text-field'
import { storeAdminSession, adminSessionHeaders } from '@/lib/admin-session'
import { authRequest, emailError } from '@/lib/auth-email'
import { AUTH_SELECTION_CLEARED_KEY } from '@/lib/hq-navigation'

const LINE_LOGIN_FAILURE_CODES = new Set([
  'line_token_failed',
  'line_id_token_missing',
  'line_verify_failed',
  'line_profile_missing',
  'line_login_failed',
])

/**
 * 運営コンソールのログイン。★V6 37-1（`InTGF`）。
 *
 * 見た目は統括のログイン（★V6 0-1）にそろえる。メール＋パスワードが主、
 * LINE ログインが副。どちらで入っても、platform_admins に登録された人だけが
 * /ops へ進める。新規登録の導線は出さない（運営は招待制）。
 */
export default function OpsLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailMessage, setEmailMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<'password' | 'line' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const errorCode = new URLSearchParams(window.location.search).get('error')
    if (errorCode === 'not_authorized') {
      setError('このアカウントは運営メンバーに登録されていません。ほかの運営メンバーに追加を依頼してください。')
    } else if (errorCode === 'not_platform_admin') {
      setError('ログインはできましたが、運営メンバーではありません。')
    } else if (errorCode && (LINE_LOGIN_FAILURE_CODES.has(errorCode) || errorCode === 'invalid_state')) {
      setError('LINEログインを完了できませんでした。もう一度お試しください。')
    } else if (errorCode) {
      setError('ログインを完了できませんでした。もう一度お試しください。')
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
    const res = await authRequest<{ twoFactor: boolean; twoFactorSetup?: boolean; challengeToken?: string; sessionToken?: string }>('/api/auth/password/login', {
      email: email.trim(),
      password,
      next: 'ops',
    })
    if (!res.ok || !res.data) {
      setError(res.error || 'ログインできませんでした')
      setBusy(null)
      return
    }
    try { sessionStorage.removeItem(AUTH_SELECTION_CLEARED_KEY) } catch { /* non-essential navigation marker */ }
    if (res.data.twoFactorSetup && res.data.challengeToken) {
      window.location.assign(`/login/two-factor/setup?next=ops#${new URLSearchParams({ lh_2fa: res.data.challengeToken }).toString()}`)
      return
    }
    if (res.data.twoFactor && res.data.challengeToken) {
      // `next=ops` は URL に残す。シークレットモードで別サイト Cookie が止まっても、
      // 二段階認証のあと通常ログインへ戻らず、運営コンソールへ確実に戻す。
      window.location.assign(`/login/two-factor?next=ops#${new URLSearchParams({ lh_2fa: res.data.challengeToken }).toString()}`)
      return
    }
    if (res.data.sessionToken) storeAdminSession(res.data.sessionToken, res.csrfToken)
    else if (res.csrfToken) localStorage.setItem('lh_csrf', res.csrfToken)

    // 運営メンバーかどうかをサーバーに確かめてから /ops へ。
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    try {
      const session = await fetch(`${apiUrl}/api/auth/session`, { credentials: 'include', headers: adminSessionHeaders() })
      const body = await session.json() as { data?: { platformAdmin?: boolean; platformAdminState?: string | null } }
      if (!body.data?.platformAdmin) {
        if (body.data?.platformAdminState === 'awaiting_totp') {
          window.location.assign('/ops/two-factor')
          return
        }
        setError('ログインはできましたが、運営メンバーではありません。')
        setBusy(null)
        return
      }
    } catch {
      setError('ログイン状態を確認できませんでした。もう一度お試しください。')
      setBusy(null)
      return
    }
    window.location.assign('/ops')
  }

  const lineLogin = () => {
    setBusy('line')
    try { sessionStorage.removeItem(AUTH_SELECTION_CLEARED_KEY) } catch { /* non-essential navigation marker */ }
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    if (!apiUrl) return setBusy(null)
    window.location.assign(`${apiUrl}/api/auth/line?next=ops`)
  }

  return (
    <AuthCard
      node="InTGF"
      cardNode="aHJXA"
      title="ログイン"
      description={
        <>
          <span className="mb-1 block text-caption font-bold text-ink-faint">運営コンソール</span>
          メールアドレスとパスワードでログインします。LINE で登録した運営メンバーは LINE でログインしてください。
        </>
      }
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex w-full flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-control bg-status-danger-soft px-4 py-3 text-label text-status-danger">
            {error}
          </p>
        ) : null}
        <AuthField label="メールアドレス" htmlFor="ops-login-email" error={emailMessage}>
          <TextField
            id="ops-login-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            invalid={Boolean(emailMessage)}
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
          />
        </AuthField>
        <AuthField label="パスワード" htmlFor="ops-login-password">
          <PasswordField id="ops-login-password" value={password} onChange={setPassword} autoComplete="current-password" />
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

      <p className="text-center text-caption text-ink-faint">
        運営メンバーの招待を受けた方は、招待メールのリンクから設定してください
      </p>
    </AuthCard>
  )
}
