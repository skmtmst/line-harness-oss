'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState, type FormEvent } from 'react'
import AuthCard, { AuthField } from '@/components/auth/auth-card'
import Turnstile, { type TurnstileHandle } from '@/components/auth/turnstile'
import Button from '@/components/shared/button'
import { TextField } from '@/components/shared/text-field'
import { authRequest, emailError, LEGAL_LINKS, readDeviceMarker, rememberSignupEmail, TURNSTILE_SITE_KEY } from '@/lib/auth-email'

/**
 * 会員登録の 1 歩目。★V6 36-4（`JBd7P`、カード `NIOtl`）。
 *
 * メールアドレスだけを入れ、本登録の URL をメールで受け取る（決定 2026-09-13）。
 * 誤ったメールでは先に進めない。返事は登録済みでも同じ「送りました」。
 */
export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [emailMessage, setEmailMessage] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [agreeMessage, setAgreeMessage] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const turnstileRef = useRef<TurnstileHandle | null>(null)
  const setTurnstileHandle = useCallback((handle: TurnstileHandle | null) => {
    turnstileRef.current = handle
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const emailProblem = emailError(email)
    setEmailMessage(emailProblem)
    setAgreeMessage(agreed ? null : '利用規約とプライバシーポリシーに同意してください')
    if (emailProblem || !agreed) return
    if (!turnstileToken) {
      setError('「私はロボットではありません」の確認を済ませてください')
      return
    }
    setBusy(true)
    setError('')
    const res = await authRequest<{ sent: boolean }>('/api/auth/register/request', {
      email: email.trim(),
      agreed: true,
      turnstileToken,
      deviceMarker: readDeviceMarker(),
    })
    if (!res.ok) {
      setError(res.error || '送信できませんでした')
      turnstileRef.current?.reset()
      setBusy(false)
      return
    }
    rememberSignupEmail(email.trim())
    router.replace('/register/sent')
  }

  return (
    <AuthCard
      node="JBd7P"
      cardNode="NIOtl"
      title="無料で始める"
      description="登録から30日はすべての機能を無料で使えます。クレジットカードは不要です。まずメールアドレスを入れてください。本登録の URL をお送りします。"
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex w-full flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-control bg-status-danger-soft px-4 py-3 text-label text-status-danger">
            {error}
          </p>
        ) : null}
        <AuthField label="メールアドレス" hint="本登録の URL が届きます。間違いがないか確かめてください" htmlFor="register-email" error={emailMessage}>
          <TextField
            id="register-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            invalid={Boolean(emailMessage)}
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            aria-describedby={emailMessage ? 'register-email-error' : undefined}
          />
        </AuthField>

        <Turnstile onToken={setTurnstileToken} handleRef={setTurnstileHandle} />

        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-2.5 text-caption text-ink">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-0.5 h-4.5 w-4.5 shrink-0 accent-accent-deep"
              aria-invalid={Boolean(agreeMessage) || undefined}
            />
            <span>
              <LegalWord href={LEGAL_LINKS.terms}>利用規約</LegalWord>と<LegalWord href={LEGAL_LINKS.privacy}>プライバシーポリシー</LegalWord>に同意します
            </span>
          </label>
          {agreeMessage ? (
            <p role="alert" className="text-micro text-status-danger">
              {agreeMessage}
            </p>
          ) : null}
        </div>

        <Button type="submit" variant="primary" disabled={busy || !TURNSTILE_SITE_KEY} className="w-full">
          {busy ? '送っています…' : '確認メールを送る'}
        </Button>
      </form>

      <p className="text-caption text-ink-faint">
        すでにアカウントをお持ちの方は{' '}
        <Link href="/login" className="font-semibold text-accent-deep hover:underline">
          ログイン
        </Link>
      </p>
    </AuthCard>
  )
}

function LegalWord({ href, children }: { href: string | null; children: string }) {
  if (!href) return <span className="font-semibold">{children}</span>
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-accent-deep hover:underline">
      {children}
    </a>
  )
}
