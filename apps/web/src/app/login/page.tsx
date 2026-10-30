'use client'

import { beginAdminLoginHandoff, twoFactorChallengeHandoffPath } from '@/lib/admin-session'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import AuthCard, { AuthField } from '@/components/auth/auth-card'
import LineLoginMark from '@/components/auth/line-login-mark'
import PasswordField from '@/components/auth/password-field'
import Turnstile, { type TurnstileHandle } from '@/components/auth/turnstile'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Notice from '@/components/shared/notice'
import TextLink from '@/components/shared/text-link'
import { AuthSubmit } from '@/components/templates/auth-page'
import { TextField } from '@/components/shared/text-field'
import { storeAdminSession } from '@/lib/admin-session'
import { authRequest, emailError, TURNSTILE_SITE_KEY } from '@/lib/auth-email'
import { resetAuthSelectionCleared } from '@/lib/hq-navigation'
import { MOBILE_LOGIN_NEXT, MOBILE_ROOT, isMobileLoginReturn } from '@/lib/mobile-shell'

const LINE_LOGIN_FAILURE_CODES = new Set([
  'line_token_failed',
  'line_id_token_missing',
  'line_verify_failed',
  'line_profile_missing',
  'line_login_failed',
])

/** 空パスワードで送信したときだけ出す入力前の案内。入力が始まったら消す。 */
const EMPTY_PASSWORD_MESSAGE = 'パスワードを入力してください'

/**
 * ログイン。★管理画面 0-1（`UufG8`、カード `m3tWJ`）。
 *
 * メール＋パスワードが主、LINE ログインが副（決定 2026-09-13）。
 * 既存の権限者は今までどおり LINE で入れる。二段階認証を有効にしている人は
 * パスワードのあとに既存の 6 桁コードの画面へ。
 */
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [emailMessage, setEmailMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<'password' | 'line' | null>(null)
  const [error, setError] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileRef = useRef<TurnstileHandle | null>(null)
  /*
   * 電話の画面（/m）から来た人（`?next=m`）。ログインの後は /m へ戻す。
   * 電話の画面はメールとパスワードで入る（ホーム画面に置いた画面から LINE へ出ると戻ってこないことがあるため）。
   */
  const [mobileReturn, setMobileReturn] = useState(false)
  const setTurnstileHandle = useCallback((handle: TurnstileHandle | null) => {
    turnstileRef.current = handle
  }, [])

  // R613: 空パスワードの案内は入力が始まったら消す。
  // 認証失敗・通信失敗・権限エラーなど別の原因の表示は次の送信まで残す。
  const handlePasswordChange = (value: string) => {
    setPassword(value)
    if (value && error === EMPTY_PASSWORD_MESSAGE) setError('')
  }

  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      setBusy(null)
      turnstileRef.current?.reset()
    }
    window.addEventListener('pageshow', restore)
    setMobileReturn(isMobileLoginReturn(window.location.search))
    const errorCode = new URLSearchParams(window.location.search).get('error')
    if (errorCode === 'not_authorized') {
      setError('このLINEアカウントには管理者権限がありません。オーナーに追加を依頼してください。')
    } else if (errorCode && (LINE_LOGIN_FAILURE_CODES.has(errorCode) || errorCode === 'invalid_state')) {
      setError('LINEログインを完了できませんでした。もう一度お試しください。')
    } else if (errorCode) {
      setError('ログインを完了できませんでした。もう一度お試しください。')
    }
    return () => window.removeEventListener('pageshow', restore)
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const emailProblem = emailError(email)
    setEmailMessage(emailProblem)
    if (emailProblem) return
    if (!password) {
      setError(EMPTY_PASSWORD_MESSAGE)
      return
    }
    if (!turnstileToken) {
      setError('「私はロボットではありません」の確認を済ませてください')
      return
    }
    setBusy('password')
    setError('')
    const res = await authRequest<{ twoFactor: boolean; twoFactorSetup?: boolean; challengeToken?: string; sessionToken?: string }>('/api/auth/password/login', {
      email: email.trim(),
      password,
      remember,
      turnstileToken,
    })
    turnstileRef.current?.reset()
    if (!res.ok || !res.data) {
      setError(res.error || 'ログインできませんでした。時間をおいて、もう一度お試しください。')
      setBusy(null)
      return
    }
    // 「消した」印は共有の localStorage。外すと次の認証確認で一度だけ
    // 前回の店舗選択を捨てる（NEXT-07）。
    resetAuthSelectionCleared(localStorage, sessionStorage)
    const twoFactorNext = mobileReturn ? `?next=${MOBILE_LOGIN_NEXT}` : ''
    if (res.data.twoFactorSetup && res.data.challengeToken) {
      window.location.assign(twoFactorChallengeHandoffPath(`/login/two-factor/setup${twoFactorNext}`, res.data.challengeToken))
      return
    }
    if (res.data.twoFactor && res.data.challengeToken) {
      // R507: 二段階認証の画面で実際のログイン方法を出せるよう、経路の印を付ける。
      window.location.assign(twoFactorChallengeHandoffPath(`/login/two-factor${twoFactorNext}`, res.data.challengeToken))
      return
    }
    if (res.data.sessionToken) storeAdminSession(res.data.sessionToken, res.csrfToken)
    else if (res.csrfToken) localStorage.setItem('lh_csrf', res.csrfToken)
    window.location.assign(mobileReturn ? MOBILE_ROOT : '/')
  }

  const lineLogin = () => {
    setBusy('line')
    resetAuthSelectionCleared(localStorage, sessionStorage)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    if (!apiUrl) return setBusy(null)
    // 「7日間ログインを保持」の選択をOAuth往復へ持ち越す印（N-434）
    window.location.assign(`${apiUrl}/api/auth/line?${new URLSearchParams({ handoff: beginAdminLoginHandoff(), ...(remember ? { remember: '1' } : {}) })}`)
  }

  // 入れ終わるまでは押せない形（本物の緑を薄く）にし、下の灰の 1 行で理由を言う。送る時の検査はそのまま。
  const missingInput = !email.trim() || !password
  const submitReason = missingInput && busy === null ? 'メールアドレスとパスワードを入れると押せます' : null

  return (
    <AuthCard
      node="UufG8"
      cardNode="m3tWJ"
      title="ログイン"
      step={{ current: 1, total: 2 }}
      description={null}
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex w-full flex-col gap-4">
        {error ? (
          <Notice tone="danger" message={error} />
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
        <AuthField
          label="パスワード"
          htmlFor="login-password"
          action={
            <TextLink inline href="/password/forgot">
              パスワードを忘れた方
            </TextLink>
          }
        >
          <PasswordField id="login-password" value={password} onChange={handlePasswordChange} autoComplete="current-password" />
        </AuthField>
        <Turnstile onToken={setTurnstileToken} handleRef={setTurnstileHandle} />
        <Checkbox
          checked={remember}
          onCheckedChange={setRemember}
        >この端末では7日間ログインを保持する</Checkbox>
        <AuthSubmit reasonId="login-submit-reason" reason={submitReason}>
          <Button fullWidth type="submit" variant="primary" disabled={busy !== null || !TURNSTILE_SITE_KEY || missingInput} aria-describedby={submitReason ? 'login-submit-reason' : undefined} className="w-full" busy={busy === 'password'} busyLabel="ログインしています…">ログイン
          </Button>
        </AuthSubmit>
      </form>

      {mobileReturn ? null : <>
        <div className="flex w-full items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-hairline" />
          <span className="text-caption text-ink-faint">または</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>

        <Button fullWidth variant="line" onClick={lineLogin} disabled={busy !== null} className="w-full" busy={busy === 'line'} busyLabel="LINEへ移動中…">
          <LineLoginMark className="h-4.5 w-4.5" />LINE でログイン
        </Button>
      </>}

      <p className="text-center text-caption text-ink-faint">
        はじめての方は{' '}
        <TextLink inline href="/register">
          無料で始める
        </TextLink>
      </p>
    </AuthCard>
  )
}
