'use client'

import { Mail } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useRef, useState, type FormEvent } from 'react'
import AuthCard, { AuthField } from '@/components/auth/auth-card'
import Turnstile, { type TurnstileHandle } from '@/components/auth/turnstile'
import Button from '@/components/shared/button'
import { TextField } from '@/components/shared/text-field'
import { authRequest, emailError, TURNSTILE_SITE_KEY } from '@/lib/auth-email'

/**
 * パスワードを忘れた。★V6 36-6-A（`fmDeV`、カード `dVI5v`）。
 *
 * 登録済みかどうかは返事で分からない（本人にだけメールが届く）。
 * LINE だけの権限者もここからパスワードを持てる。
 */
export default function PasswordForgotPage() {
  const [email, setEmail] = useState('')
  const [emailMessage, setEmailMessage] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState('')
  const turnstileRef = useRef<TurnstileHandle | null>(null)
  const setTurnstileHandle = useCallback((handle: TurnstileHandle | null) => {
    turnstileRef.current = handle
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const emailProblem = emailError(email)
    setEmailMessage(emailProblem)
    if (emailProblem) return
    if (!turnstileToken) {
      setError('「私はロボットではありません」の確認を済ませてください')
      return
    }
    setBusy(true)
    setError('')
    const res = await authRequest<{ sent: boolean }>('/api/auth/password/forgot', { email: email.trim(), turnstileToken })
    if (!res.ok) {
      setError(res.error || '送信できませんでした')
      turnstileRef.current?.reset()
      setBusy(false)
      return
    }
    setSentTo(email.trim())
    setBusy(false)
  }

  if (sentTo) {
    return (
      <AuthCard
        node="fmDeV"
        cardNode="dVI5v"
        title="再設定メールを送りました"
        description={
          <>
            <span className="font-semibold text-ink">{sentTo}</span> が登録されていれば、パスワードを設定し直す URL が届きます。URL の有効期限は 1 時間です。
          </>
        }
      >
        <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-pill bg-accent-soft">
          <Mail className="h-7 w-7 text-accent-deep" />
        </span>
        <p className="text-caption text-ink-secondary">届かないときは、迷惑メールフォルダと、入れたメールアドレスを確かめてください。</p>
        <Button href="/login" className="w-full">
          ログインへ戻る
        </Button>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      node="fmDeV"
      cardNode="dVI5v"
      title="パスワードを忘れた"
      description="登録しているメールアドレスを入れてください。パスワードを設定し直す URL をお送りします。"
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex w-full flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-control bg-status-danger-soft px-4 py-3 text-label text-status-danger">
            {error}
          </p>
        ) : null}
        <AuthField label="メールアドレス" hint="登録時のメールアドレス" htmlFor="forgot-email" error={emailMessage}>
          <TextField
            id="forgot-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            invalid={Boolean(emailMessage)}
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            aria-describedby={emailMessage ? 'forgot-email-error' : undefined}
          />
        </AuthField>
        <Turnstile onToken={setTurnstileToken} handleRef={setTurnstileHandle} />
        <Button type="submit" variant="primary" disabled={busy || !TURNSTILE_SITE_KEY} className="w-full">
          {busy ? '送っています…' : '再設定メールを送る'}
        </Button>
      </form>
      <p className="text-caption text-ink-faint">
        思い出した方は{' '}
        <Link href="/login" className="font-semibold text-accent-deep hover:underline">
          ログイン
        </Link>
      </p>
    </AuthCard>
  )
}
