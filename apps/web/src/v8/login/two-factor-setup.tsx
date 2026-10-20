'use client'

import { describeApiFailure } from '@/components/shared/api-error-message'
import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Button from '@/components/shared/button'
import { adminSessionHandoffPath, adminSessionHeaders, captureTwoFactorChallenge, clearTwoFactorChallenge, storeAdminSession, takeTwoFactorNextPath } from '@/lib/admin-session'
import { ApiError, describeSaveFailure, responseApiError } from '@/lib/api'
import { qrToDataURL } from '@/lib/qr-image'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import OtpInput, { otpFailureMessage } from '@/components/shared/otp-input'
import { isTwoFactorChallengeGone, twoFactorFailureMessage } from '@/v8/login/two-factor/two-factor-error'

import { Steps } from '@/components/templates/steps'
import { AuthPage, AuthForm } from '@/components/templates/auth-page'
import TotpQr from '@/components/shared/totp-qr'
import RecoveryCodes from './recovery-codes'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'

type SetupData = { provisioningUri: string; manualKey: string }

/**
 * 二段階認証の初回設定（N-426）。
 *
 * Onの統括でTOTP未登録の人は、ログインの直後に
 * 設定専用の合言葉付きでここへ回される。通常セッションはまだ無いため、
 * 画面は合言葉（`#lh_2fa=`）だけで setup/confirm API を呼ぶ。
 * 確認が通るとその場でセッションが発行され、管理画面へ進む。
 */
export default function TwoFactorSetupPage() {
  const saveErrors = useSaveFormErrors()
  const [challenge, setChallenge] = useState('')
  const [setup, setSetup] = useState<SetupData | null>(null)
  const [qr, setQr] = useState('')
  const [typedCode, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** M033: 開始の読み込み失敗。その場で再試行できるよう捕まえた失敗を残す。 */
  const [setupError, setSetupError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  /** R508: 合言葉が使えなくなった（期限切れ・回数制限）。入力は終わらせる。 */
  const [expired, setExpired] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [destination, setDestination] = useState('')

  // M033: 開始の失敗は合言葉が生きていればその場で再試行する。
  // 再ログインに戻すのは、合言葉が無いときと期限切れ401のときだけ。
  // 403は再試行を出さず、429は待ち案内にする（ListState の error が言い分ける）。
  const loadSetup = useCallback(async (token: string, isRetry = false) => {
    if (isRetry) setRetrying(true)
    else setLoading(true)
    setSetupError(null)
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/two-factor/setup`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: token }),
      })
      const body = await response.json().catch(() => ({})) as { success?: boolean; error?: string; data?: SetupData }
      if (!response.ok || !body.success || !body.data) {
        const retryAfter = Number(response.headers?.get('Retry-After'))
        throw responseApiError(response, JSON.stringify(body), undefined, undefined, {
          preserveBodyMessage: true, fallbackMessage: '設定を始められませんでした',
          retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        })
      }
      setSetup(body.data)
    } catch (caught) {
      const failure = caught instanceof ApiError
        ? caught
        : new ApiError(0, describeSaveFailure(caught))
      if (failure.status === 401) {
        // 合言葉の期限切れ。再試行は通らないので入力を終わらせる。
        setExpired(true)
        setSetup(null)
        setError(describeApiFailure(failure, '設定の開始'))
      } else {
        setSetupError(failure)
      }
    } finally {
      setLoading(false)
      setRetrying(false)
    }
  }, [])

  useEffect(() => {
    const token = captureTwoFactorChallenge()
    setChallenge(token)
    if (!token) {
      setError('設定の合言葉がありません。ログインからやり直してください')
      setLoading(false)
      return
    }
    void loadSetup(token)
  }, [loadSetup])

  useEffect(() => {
    if (!setup?.provisioningUri) return
    let cancelled = false
    void qrToDataURL(setup.provisioningUri, { width: 200, margin: 1 }).then(value => { if (!cancelled) setQr(value) }).catch(() => { if (!cancelled) setError('QRコードを表示できませんでした。キーを手で入力してください') })
    return () => { cancelled = true }
  }, [setup])

  /* 6桁目が入った瞬間にも送る（entered）。送っている間は二重に送らない。 */
  const submit = async (event?: FormEvent, entered?: string) => {
    event?.preventDefault()
    if (busy) return
    const code = entered ?? typedCode
    const digits = code.replace(/\D/g, '')
    if (!challenge || digits.length !== 6) return setError('6桁の認証コードを入力してください')
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/two-factor/setup/confirm`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: challenge, code: digits }),
      })
      const body = await response.json() as { success: boolean; error?: string; fields?: Record<string, string>; data?: { sessionToken?: string; recoveryCodes?: string[] }; csrfToken?: string }
      if (!response.ok || !body.success) {
        if (isTwoFactorChallengeGone(response.status)) {
          // 合言葉はサーバー側で消えている。再試行は通らないので入力を終わらせる。
          setExpired(true)
          setSetup(null)
          setCode('')
        }
        throw responseApiError(response, JSON.stringify(body), undefined, undefined, { preserveBodyMessage: true, fallbackMessage: '登録を完了できませんでした' })
      }
      if (body.data?.sessionToken) storeAdminSession(body.data.sessionToken, body.csrfToken)
      else if (body.csrfToken) {
        try { localStorage.setItem('lh_csrf', body.csrfToken) } catch { /* Cookie session is sufficient */ }
      }
      const nextPath = takeTwoFactorNextPath()
      if (nextPath === '/ops') {
        const session = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/session`, {
          credentials: 'include',
          headers: adminSessionHeaders(body.data?.sessionToken),
        })
        const sessionBody = await session.json().catch(() => ({})) as { success?: boolean; data?: { platformAdmin?: boolean } }
        if (!session.ok || !sessionBody.success || !sessionBody.data?.platformAdmin) {
          throw new Error('2要素認証は登録できましたが、運営メンバーの有効状態を確認できませんでした')
        }
      }
      clearTwoFactorChallenge()
      const path = adminSessionHandoffPath(nextPath, body.data?.sessionToken, body.csrfToken)
      if (body.data?.recoveryCodes?.length) { setDestination(path); setRecoveryCodes(body.data.recoveryCodes) }
      else window.location.assign(path)
    } catch (caught) {
      // R506のついで: 通信断の技術文言をそのまま出さない。
      if (!saveErrors.capture(caught)) setError(otpFailureMessage(twoFactorFailureMessage(caught, '登録を完了できませんでした')))
      setCode('')
    } finally { setBusy(false) }
  }

  if (recoveryCodes.length) return <RecoveryCodes codes={recoveryCodes} onContinue={() => { setRecoveryCodes([]); window.location.assign(destination) }} />
  return <SaveErrorScope errors={saveErrors}><AuthPage titleAlign="start" steps={<Steps label="ログインの手順" steps={[{ label: 'ログイン', state: 'done' }, { label: '二段階認証の設定', state: 'current' }]} />} title="二段階認証を設定">
    {error ? <Notice tone="danger" message={error} /> : null}
    {loading ? <ListState kind="loading" title="QRコードを用意しています…" /> : setup ? (
      <AuthForm onSubmit={event => void submit(event)}>
        <TotpQr qr={qr} manualKey={setup.manualKey} />
          <SaveErrorField names={["code", "typedCode"]}><OtpInput id="totp-setup-code" value={typedCode} onChange={setCode} onComplete={entered => void submit(undefined, entered)} visualLabel="認証アプリの6桁の数字" label="認証アプリの6桁の数字" invalid={Boolean(error)} busy={busy} /></SaveErrorField>
        <Button type="submit" variant="primary" fullWidth disabled={busy} busy={busy} busyLabel="確認しています…">登録してログイン</Button>
        <Link href="/login" onClick={clearTwoFactorChallenge}>ログインへ戻る</Link>
      </AuthForm>
    ) : expired || !challenge ? (
      <Link href="/login" onClick={clearTwoFactorChallenge}>ログインへ戻る</Link>
    ) : <ListState kind="error" error={setupError ?? undefined} onRetry={() => void loadSetup(challenge, true)} retrying={retrying} />}
  </AuthPage></SaveErrorScope>
}
