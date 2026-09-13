'use client'

import { Check } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState, type FormEvent } from 'react'
import AuthCard, { AuthField } from '@/components/auth/auth-card'
import PasswordField from '@/components/auth/password-field'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { authRequest, confirmError, passwordError } from '@/lib/auth-email'

/**
 * 新しいパスワードを設定。★V6 36-6-B（`KN3y1`、カード `fWkBE`）。
 *
 * メールの URL（`?token=`）から開く。設定するとその人のログインはすべて解除され、
 * 新しいパスワードでログインし直す。
 */
export default function PasswordResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  )
}

type TokenCheck = { state: 'checking' } | { state: 'ok'; email: string } | { state: 'bad'; message: string } | { state: 'done'; email: string }

function ResetInner() {
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
    void authRequest<{ email: string }>(`/api/auth/password/reset/check?token=${encodeURIComponent(token)}`).then((res) => {
      if (!alive) return
      if (res.ok && res.data) setCheck({ state: 'ok', email: res.data.email })
      else setCheck({ state: 'bad', message: res.error || 'この URL は使えません' })
    })
    return () => {
      alive = false
    }
  }, [token])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const next = { password: passwordError(password), confirm: confirmError(password, confirm) }
    setMessages(next)
    if (next.password || next.confirm) return
    setBusy(true)
    setError('')
    const res = await authRequest<{ email: string }>('/api/auth/password/reset', { token, password })
    if (!res.ok || !res.data) {
      if (res.errors) setMessages((current) => ({ ...current, ...res.errors }))
      setError(res.error || '設定できませんでした')
      setBusy(false)
      return
    }
    setCheck({ state: 'done', email: res.data.email })
  }

  if (check.state === 'checking') {
    return (
      <AuthCard node="KN3y1" cardNode="fWkBE" title="新しいパスワードを設定" description="URL を確かめています">
        <ListState kind="loading" title="URL を確かめています" />
      </AuthCard>
    )
  }
  if (check.state === 'bad') {
    return (
      <AuthCard node="KN3y1" cardNode="fWkBE" title="新しいパスワードを設定" description={check.message}>
        <Button href="/password/forgot" variant="primary" className="w-full">
          もう一度メールを送る
        </Button>
        <Button href="/login" className="w-full">
          ログインへ
        </Button>
      </AuthCard>
    )
  }
  if (check.state === 'done') {
    return (
      <AuthCard node="KN3y1" cardNode="fWkBE" title="パスワードを設定しました" description="新しいパスワードでログインしてください。ほかの端末のログインは解除されています。">
        <Button href="/login" variant="primary" className="w-full">
          ログインへ
        </Button>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      node="KN3y1"
      cardNode="fWkBE"
      title="新しいパスワードを設定"
      description="新しいパスワードを 2 回入れてください。設定すると、ほかの端末のログインはすべて解除されます。"
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex w-full flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-control bg-status-danger-soft px-4 py-3 text-label text-status-danger">
            {error}
          </p>
        ) : null}
        <AuthField label="メールアドレス" hint="この権限者のパスワードを変えます" htmlFor="reset-email">
          <div id="reset-email" className="flex h-11 w-full items-center justify-between rounded-control border border-hairline bg-surface-pearl px-3 text-label text-ink-secondary">
            <span className="truncate">{check.email}</span>
            <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-accent-deep" />
          </div>
        </AuthField>
        <AuthField label="パスワード" hint="8文字以上・英字と数字" htmlFor="reset-password" error={messages.password}>
          <PasswordField id="reset-password" value={password} onChange={setPassword} invalid={Boolean(messages.password)} autoComplete="new-password" />
        </AuthField>
        <AuthField label="パスワード（確認）" htmlFor="reset-confirm" error={messages.confirm}>
          <PasswordField id="reset-confirm" value={confirm} onChange={setConfirm} invalid={Boolean(messages.confirm)} autoComplete="new-password" />
        </AuthField>
        <Button type="submit" variant="primary" disabled={busy} className="w-full">
          {busy ? '設定しています…' : 'パスワードを設定してログインへ'}
        </Button>
      </form>
    </AuthCard>
  )
}
