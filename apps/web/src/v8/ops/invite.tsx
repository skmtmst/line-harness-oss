'use client'

import { ArrowRight } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import PasswordField from '@/components/auth/password-field'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { TextField } from '@/components/shared/text-field'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import { adminSessionHandoffPath, storeAdminSession } from '@/lib/admin-session'
import { authRequest, passwordError } from '@/lib/auth-email'
import { ApiError } from '@/lib/api'
import { resetAuthSelectionCleared } from '@/lib/hq-navigation'
import styles from './auth.module.css'

type Check = { email: string; name: string; needsPassword: boolean }

/**
 * 運営メンバーの招待を受ける V8（絵 `tVaUh`）。
 *
 * 動きは v7（app/ops/invite）と同じ。メールの URL の `#invite=…` を読み、
 * パスワードが無い人は名前とパスワードを決める。進んだ先は 2要素認証の設定。
 */
export default function OpsInviteV8() {
  const [token, setToken] = useState('')
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [acceptCode, setAcceptCode] = useState<string | null>(null)
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
  const [checkFailed, setCheckFailed] = useState<unknown>(null)

  const checkInvite = useCallback(async () => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const value = hash.get('invite') ?? ''
    setToken(value)
    setState('loading')
    setMessage('')
    setCheckFailed(null)
    setInviteCode(null)
    if (!value) { setState('invalid'); setMessage('この招待は見つかりません。招待した運営メンバーに確認してください'); return }
    const res = await authRequest<Check>(`/api/auth/ops-invite/check?token=${encodeURIComponent(value)}`)
    if (!res.ok || !res.data) {
      setCheckFailed(new ApiError(res.status, res.error))
      setInviteCode(res.code ?? null)
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
    setAcceptCode(null)
    const res = await authRequest<{ next: string; sessionToken?: string }>('/api/auth/ops-invite/accept', {
      token,
      ...(check.needsPassword ? { name: name.trim(), password } : {}),
    })
    if (!res.ok || !res.data) {
      setError(res.error || '登録を進められませんでした')
      setAcceptCode(res.code ?? null)
      setBusy(false)
      return
    }
    resetAuthSelectionCleared(localStorage, sessionStorage)
    if (res.data.sessionToken) storeAdminSession(res.data.sessionToken, res.csrfToken)
    else if (res.csrfToken) {
      try { localStorage.setItem('lh_csrf', res.csrfToken) } catch { /* Cookie のセッションで足りる */ }
    }
    window.location.assign(adminSessionHandoffPath('/ops/two-factor', res.data.sessionToken, res.csrfToken))
  }

  const usedInvite = inviteCode === 'used' || acceptCode === 'used'
  const fieldError = (id: string, text: string | null) => (text ? <p id={id} className={styles.error}>{text}</p> : null)

  return (
    <main className={styles.page} data-design-node="tVaUh">
      <div className={styles.brand}>
        <span className={styles.mark} aria-hidden="true">m</span>
        <span className={styles.brandText}>
          <span className={styles.brandName}>musubo</span>
          <span className={styles.brandSub}>運営コンソール</span>
        </span>
      </div>
      <section className={styles.card} aria-labelledby="ops-invite-title">
        <h1 id="ops-invite-title" className={styles.title}>運営メンバーの招待</h1>
        <p className={styles.lead}>
          {check && !check.needsPassword
            ? '運営コンソールに招待されました（有効期限は24時間）。続けると 2要素認証の設定に進みます。'
            : '運営コンソールに招待されました（有効期限は24時間）。名前とパスワードを決めると、次に2要素認証を設定します。'}
        </p>
        {state === 'loading' ? (
          <ListState kind="loading" title="招待を確認しています" />
        ) : state === 'invalid' ? (
          <>
            <ListState
              kind="error"
              title={inviteCode === 'used' ? 'この招待はすでに使われています' : inviteCode === 'expired' ? 'この招待は期限切れです' : 'この招待は使えません'}
              description={isForbiddenOrRateLimited(checkFailed) ? undefined : message}
              error={checkFailed ?? undefined}
              onRetry={() => void checkInvite()}
            />
            {inviteCode === 'used' ? <Button href="/ops/login" className={styles.wide}>運営のログインへ</Button> : null}
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)} noValidate className={styles.form}>
            {error ? <Notice tone="danger" message={error} /> : null}
            {usedInvite && error ? <Button href="/ops/login" className={styles.wide}>運営のログインへ</Button> : null}
            <div className={styles.field}>
              <label htmlFor="ops-invite-email" className={styles.label}>メールアドレス</label>
              <TextField id="ops-invite-email" type="email" value={check?.email ?? ''} readOnly />
            </div>
            {check?.needsPassword ? (
              <>
                <div className={styles.field}>
                  <label htmlFor="ops-invite-name" className={styles.label}>名前</label>
                  <TextField id="ops-invite-name" value={name} onChange={(event) => setName(event.target.value)} invalid={Boolean(nameMessage)} aria-describedby={nameMessage ? 'ops-invite-name-error' : undefined} autoComplete="name" placeholder="山田 花子" />
                  {fieldError('ops-invite-name-error', nameMessage)}
                </div>
                <div className={styles.field}>
                  <label htmlFor="ops-invite-password" className={styles.label}>パスワード（8文字以上）</label>
                  <PasswordField id="ops-invite-password" value={password} onChange={setPassword} invalid={Boolean(passwordMessage)} autoComplete="new-password" />
                  {fieldError('ops-invite-password-error', passwordMessage)}
                </div>
                <div className={styles.field}>
                  <label htmlFor="ops-invite-confirm" className={styles.label}>パスワード（確認）</label>
                  <PasswordField id="ops-invite-confirm" value={confirm} onChange={setConfirm} invalid={Boolean(confirmMessage)} autoComplete="new-password" />
                  {fieldError('ops-invite-confirm-error', confirmMessage)}
                </div>
              </>
            ) : null}
            <Button type="submit" variant="primary" disabled={busy} className={styles.wide} busy={busy} busyLabel="進めています…">
              <ArrowRight aria-hidden="true" />{check?.needsPassword ? 'パスワードを設定して次へ' : '設定して2要素認証へ進む'}
            </Button>
          </form>
        )}
      </section>
      <p className={styles.foot}>この画面は運営メンバーだけが開けます。操作はすべて記録されます。</p>
    </main>
  )
}
