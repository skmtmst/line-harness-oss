'use client'

import { LogIn, MessageCircle } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import PasswordField from '@/components/auth/password-field'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { TextField } from '@/components/shared/text-field'
import { storeAdminSession, adminSessionHeaders } from '@/lib/admin-session'
import { authRequest, emailError, internalAuthFailureCopy } from '@/lib/auth-email'
import { resetAuthSelectionCleared } from '@/lib/hq-navigation'
import styles from './auth.module.css'

const LINE_LOGIN_FAILURE_CODES = new Set([
  'line_token_failed',
  'line_id_token_missing',
  'line_verify_failed',
  'line_profile_missing',
  'line_login_failed',
])

/**
 * 運営コンソールのログイン V8（絵 `D9JALJ`）。
 *
 * 動きは v7（app/ops/login）と同じ：メール＋パスワードが主、LINE が副。
 * 入れた後に /api/auth/session で運営メンバーかを確かめてから /ops へ進む。
 * 2要素認証が要る人は /login/two-factor（設定がまだなら setup）へ送る。
 */
export default function OpsLoginV8() {
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
      setError(internalAuthFailureCopy(res.status, res.error) ?? res.error ?? 'ログインできませんでした')
      setBusy(null)
      return
    }
    resetAuthSelectionCleared(localStorage, sessionStorage)
    if (res.data.twoFactorSetup && res.data.challengeToken) {
      window.location.assign(`/login/two-factor/setup?next=ops#${new URLSearchParams({ lh_2fa: res.data.challengeToken }).toString()}`)
      return
    }
    if (res.data.twoFactor && res.data.challengeToken) {
      window.location.assign(`/login/two-factor?next=ops#${new URLSearchParams({ lh_2fa: res.data.challengeToken }).toString()}`)
      return
    }
    if (res.data.sessionToken) storeAdminSession(res.data.sessionToken, res.csrfToken)
    else if (res.csrfToken) {
      try { localStorage.setItem('lh_csrf', res.csrfToken) } catch { /* Cookie のセッションで足りる */ }
    }

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
    resetAuthSelectionCleared(localStorage, sessionStorage)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    if (!apiUrl) return setBusy(null)
    window.location.assign(`${apiUrl}/api/auth/line?next=ops`)
  }

  return (
    <main className={styles.page} data-design-node="D9JALJ">
      <div className={styles.brand}>
        <span className={styles.mark} aria-hidden="true">m</span>
        <span className={styles.brandText}>
          <span className={styles.brandName}>musubo</span>
          <span className={styles.brandSub}>運営コンソール</span>
        </span>
      </div>
      <section className={styles.card} aria-labelledby="ops-login-title">
        <h1 id="ops-login-title" className={styles.title}>ログイン</h1>
        <form onSubmit={(event) => void submit(event)} noValidate className={styles.form}>
          {error ? <Notice tone="danger" message={error} /> : null}
          <div className={styles.field}>
            <label htmlFor="ops-login-email" className={styles.label}>メールアドレス</label>
            <TextField
              id="ops-login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              invalid={Boolean(emailMessage)}
              aria-describedby={emailMessage ? 'ops-login-email-error' : undefined}
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
            />
            {emailMessage ? <p id="ops-login-email-error" className={styles.error}>{emailMessage}</p> : null}
          </div>
          <div className={styles.field}>
            <label htmlFor="ops-login-password" className={styles.label}>パスワード</label>
            <PasswordField id="ops-login-password" value={password} onChange={setPassword} autoComplete="current-password" />
          </div>
          <Button type="submit" variant="primary" disabled={busy !== null} className={styles.wide} busy={busy === 'password'} busyLabel="ログインしています…">
            <LogIn aria-hidden="true" />ログイン
          </Button>
        </form>
        <div className={styles.or} aria-hidden="true">
          <span className={styles.rule} />
          <span>または</span>
          <span className={styles.rule} />
        </div>
        <Button onClick={lineLogin} disabled={busy !== null} className={styles.wide} busy={busy === 'line'} busyLabel="LINEへ移動中…">
          <MessageCircle aria-hidden="true" />LINE でログイン
        </Button>
        <Link href="/password/forgot" className={styles.forgot}>パスワードを忘れた方はこちら</Link>
        <p className={styles.note}>運営メンバーの招待を受けた方は、招待メールのリンクから設定してください</p>
      </section>
      <p className={styles.foot}>この画面は運営メンバーだけが開けます。操作はすべて記録されます。</p>
    </main>
  )
}
