'use client'

import { useEffect, useState, type FormEvent } from 'react'
import AuthCard, { AuthField } from '@/components/auth/auth-card'
import PasswordField from '@/components/auth/password-field'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { TextField } from '@/components/shared/text-field'
import { adminSessionHandoffPath, storeAdminSession } from '@/lib/admin-session'
import { authRequest, passwordError } from '@/lib/auth-email'
import { AUTH_SELECTION_CLEARED_KEY } from '@/lib/hq-navigation'

/**
 * 運営メンバーの招待を受ける（★V6 37-10-A `J6KbIg`）。
 *
 * メールの URL（`#invite=…`）から開く。トークンは # の後ろに置き、サーバーのログや
 * リファラに残さない。パスワードが無い人は名前とパスワードを決め、あればそのまま進む。
 * 進んだ先は 2要素認証の設定（37-10-B）。そこを通るまで運営メンバーにはならない。
 */
type Check = { email: string; name: string; needsPassword: boolean }

export default function OpsInvitePage() {
  const [token, setToken] = useState('')
  const [check, setCheck] = useState<Check | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>('loading')
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [nameMessage, setNameMessage] = useState<string | null>(null)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const value = hash.get('invite') ?? ''
    setToken(value)
    if (!value) { setState('invalid'); setMessage('この招待は見つかりません。招待した運営メンバーに確認してください'); return }
    void authRequest<Check>(`/api/auth/ops-invite/check?token=${encodeURIComponent(value)}`).then((res) => {
      if (!res.ok || !res.data) { setState('invalid'); setMessage(res.error || 'この招待は使えません'); return }
      setCheck(res.data)
      setName(res.data.needsPassword ? '' : res.data.name)
      setState('ready')
    })
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!check) return
    if (check.needsPassword) {
      const nameProblem = name.trim() ? null : 'お名前を入力してください'
      const passwordProblem = passwordError(password)
      const confirmProblem = password === confirm ? null : 'パスワードが一致しません'
      setNameMessage(nameProblem)
      setPasswordMessage(passwordProblem)
      setConfirmMessage(confirmProblem)
      if (nameProblem || passwordProblem || confirmProblem) return
    }
    setBusy(true)
    setError('')
    const res = await authRequest<{ next: string; sessionToken?: string }>('/api/auth/ops-invite/accept', {
      token,
      ...(check.needsPassword ? { name: name.trim(), password } : {}),
    })
    if (!res.ok || !res.data) {
      setError(res.error || '登録を進められませんでした')
      setBusy(false)
      return
    }
    try { sessionStorage.removeItem(AUTH_SELECTION_CLEARED_KEY) } catch { /* non-essential navigation marker */ }
    if (res.data.sessionToken) storeAdminSession(res.data.sessionToken, res.csrfToken)
    else if (res.csrfToken) {
      try { localStorage.setItem('lh_csrf', res.csrfToken) } catch { /* Cookie session is sufficient */ }
    }
    window.location.assign(adminSessionHandoffPath('/ops/two-factor', res.data.sessionToken, res.csrfToken))
  }

  return (
    <AuthCard
      node="J6KbIg"
      cardNode="v6cPGq"
      title="運営メンバーの招待"
      description={
        <>
          <span className="mb-1 block text-caption font-bold text-ink-faint">運営コンソール</span>
          {check?.needsPassword
            ? 'musubo 運営コンソールに招待されています。名前とパスワードを設定してください。設定のあと、2要素認証の登録に進みます。'
            : 'musubo 運営コンソールに招待されています。続けると 2要素認証の登録に進みます。'}
        </>
      }
    >
      {state === 'loading' ? (
        <ListState kind="loading" title="招待を確認しています" />
      ) : state === 'invalid' ? (
        <ListState kind="error" title="この招待は使えません" description={message} />
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate className="flex w-full flex-col gap-4">
          {error ? (
            <p role="alert" className="rounded-control bg-status-danger-soft px-4 py-3 text-label text-status-danger">{error}</p>
          ) : null}
          <AuthField label="メールアドレス" htmlFor="ops-invite-email">
            <TextField id="ops-invite-email" type="email" value={check?.email ?? ''} readOnly />
          </AuthField>
          {check?.needsPassword ? (
            <>
              <AuthField label="名前" htmlFor="ops-invite-name" error={nameMessage}>
                <TextField id="ops-invite-name" value={name} onChange={(event) => setName(event.target.value)} invalid={Boolean(nameMessage)} autoComplete="name" placeholder="山田 花子" />
              </AuthField>
              <AuthField label="パスワード（8文字以上）" htmlFor="ops-invite-password" error={passwordMessage}>
                <PasswordField id="ops-invite-password" value={password} onChange={setPassword} invalid={Boolean(passwordMessage)} autoComplete="new-password" />
              </AuthField>
              <AuthField label="パスワード（確認）" htmlFor="ops-invite-confirm" error={confirmMessage}>
                <PasswordField id="ops-invite-confirm" value={confirm} onChange={setConfirm} invalid={Boolean(confirmMessage)} autoComplete="new-password" />
              </AuthField>
            </>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            {busy ? '進めています…' : '設定して2要素認証へ進む'}
          </Button>
          <p className="text-center text-caption text-ink-faint">
            招待の有効期限は24時間です。期限が切れたときは、招待した運営メンバーに送り直しを依頼してください
          </p>
        </form>
      )}
    </AuthCard>
  )
}
