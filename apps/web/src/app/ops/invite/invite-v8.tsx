'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AuthField } from '@/components/auth/auth-card'
import PasswordField from '@/components/auth/password-field'
import { OpsAuthV8 } from '../auth-v8'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { TextField } from '@/components/shared/text-field'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import { adminSessionHandoffPath, storeAdminSession } from '@/lib/admin-session'
import { authRequest, passwordError } from '@/lib/auth-email'
import { ApiError } from '@/lib/api'
import { resetAuthSelectionCleared } from '@/lib/hq-navigation'

/**
 * 運営メンバーの招待を受ける（★V6 37-10-A `J6KbIg`）。
 *
 * メールの URL（`#invite=…`）から開く。トークンは # の後ろに置き、サーバーのログや
 * リファラに残さない。パスワードが無い人は名前とパスワードを決め、あればそのまま進む。
 * 進んだ先は 2要素認証の設定（37-10-B）。そこを通るまで運営メンバーにはならない。
 */
type Check = { email: string; name: string; needsPassword: boolean }

/*
 * ★V8-B 運営メンバーの招待（板 `tVaUh`）。
 * v7（page.tsx の器）とは別の器。データの口・動きは v7 と同じ。
 * 招待した人の名前は口が返さないため、見本の文面は使わない。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる。
 */
export function OpsInviteV8() {
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
  // M039：確認で捕まえた失敗そのもの。通信断は読み直しの口を出し、
  // 403・429 は共通の1枚（権限の案内・待ち案内）へ切り替える。
  const [checkFailed, setCheckFailed] = useState<unknown>(null)

  // M039：通信断で確認に失敗しても、その場で確認をやり直せる。
  const checkInvite = useCallback(async () => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const value = hash.get('invite') ?? ''
    setToken(value)
    setState('loading')
    setMessage('')
    setCheckFailed(null)
    if (!value) { setState('invalid'); setMessage('この招待は見つかりません。招待した運営メンバーに確認してください'); return }
    const res = await authRequest<Check>(`/api/auth/ops-invite/check?token=${encodeURIComponent(value)}`)
    if (!res.ok || !res.data) {
      setCheckFailed(new ApiError(res.status, res.error))
      setState('invalid'); setMessage(res.error || 'この招待は使えません'); return
    }
    setCheck(res.data)
    setName(res.data.needsPassword ? '' : res.data.name)
    setState('ready')
  }, [])

  useEffect(() => { void checkInvite() }, [checkInvite])

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
    resetAuthSelectionCleared(localStorage, sessionStorage)
    if (res.data.sessionToken) storeAdminSession(res.data.sessionToken, res.csrfToken)
    else if (res.csrfToken) {
      try { localStorage.setItem('lh_csrf', res.csrfToken) } catch { /* Cookie session is sufficient */ }
    }
    window.location.assign(adminSessionHandoffPath('/ops/two-factor', res.data.sessionToken, res.csrfToken))
  }

  return (
    <OpsAuthV8
      node="tVaUh"
      title="運営メンバーの招待"
      description={
        check?.needsPassword
          ? 'musubo 運営コンソールに招待されています。名前とパスワードを決めると、次に2要素認証を設定します。'
          : 'musubo 運営コンソールに招待されています。続けると 2要素認証の登録に進みます。'
      }
      footNote="この画面は運営メンバーだけが開けます。操作はすべて記録されます。"
    >
      {state === 'loading' ? (
        <ListState kind="loading" title="招待を確認しています" />
      ) : state === 'invalid' ? (
        <ListState
          kind="error"
          title="この招待は使えません"
          description={isForbiddenOrRateLimited(checkFailed) ? undefined : message}
          error={checkFailed ?? undefined}
          onRetry={() => void checkInvite()}
        />
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate className="flex w-full flex-col gap-4">
          {error ? (
            <Notice tone="danger" message={error} />
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
          <Button type="submit" variant="primary" disabled={busy} className="w-full" busy={busy} busyLabel="進めています…">
            {check?.needsPassword ? 'パスワードを設定して次へ' : '設定して2要素認証へ進む'}
          </Button>
          {check?.needsPassword ? null : (
            <p className="text-center text-caption text-ink-faint">
              招待の有効期限は24時間です。期限が切れたときは、招待した運営メンバーに送り直しを依頼してください
            </p>
          )}
        </form>
      )}
    </OpsAuthV8>
  )
}
