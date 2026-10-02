'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Button from '@/components/shared/button'
import { adminSessionHandoffPath, adminSessionHeaders, captureTwoFactorChallenge, clearTwoFactorChallenge, storeAdminSession, takeTwoFactorNextPath } from '@/lib/admin-session'
import { ApiError } from '@/lib/api'
import { useBrand } from '@/lib/use-brand'
import { qrToDataURL } from '@/lib/qr-image'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import OtpInput from '@/components/shared/otp-input'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { isTwoFactorChallengeGone, twoFactorFailureMessage } from '../two-factor-error'

type SetupData = { provisioningUri: string; manualKey: string }

/**
 * 二段階認証の初回設定（N-426）。
 *
 * 管理者束（owner/admin）でTOTP未登録の人は、ログインの直後に
 * 設定専用の合言葉付きでここへ回される。通常セッションはまだ無いため、
 * 画面は合言葉（`#lh_2fa=`）だけで setup/confirm API を呼ぶ。
 * 確認が通るとその場でセッションが発行され、管理画面へ進む。
 */
export default function TwoFactorSetupPage() {
  const [challenge, setChallenge] = useState('')
  const [setup, setSetup] = useState<SetupData | null>(null)
  const [qr, setQr] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** M033: 開始の読み込み失敗。その場で再試行できるよう捕まえた失敗を残す。 */
  const [setupError, setSetupError] = useState<unknown>(null)
  const [retrying, setRetrying] = useState(false)
  /** R508: 合言葉が使えなくなった（期限切れ・回数制限）。入力は終わらせる。 */
  const [expired, setExpired] = useState(false)
  const brand = useBrand()

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
        throw new ApiError(
          response.status,
          typeof body.error === 'string' && body.error ? body.error : '設定を始められませんでした',
          undefined, undefined, undefined,
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        )
      }
      setSetup(body.data)
    } catch (caught) {
      const failure = caught instanceof ApiError
        ? caught
        : new ApiError(0, caught instanceof Error && caught.message ? caught.message : '設定を始められませんでした')
      if (failure.status === 401) {
        // 合言葉の期限切れ。再試行は通らないので入力を終わらせる。
        setExpired(true)
        setSetup(null)
        setError(failure.message || '設定を始められませんでした')
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
    void qrToDataURL(setup.provisioningUri, { width: 200, margin: 1 }).then(setQr)
  }, [setup])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const digits = code.replace(/\D/g, '')
    if (!challenge || digits.length !== 6) return setError('6桁の認証コードを入力してください')
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/two-factor/setup/confirm`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: challenge, code: digits }),
      })
      const body = await response.json() as { success: boolean; error?: string; data?: { sessionToken?: string }; csrfToken?: string }
      if (!response.ok || !body.success) {
        if (isTwoFactorChallengeGone(response.status)) {
          // 合言葉はサーバー側で消えている。再試行は通らないので入力を終わらせる。
          setExpired(true)
          setSetup(null)
          setCode('')
        }
        throw new Error(body.error || '登録を完了できませんでした')
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
      window.location.assign(adminSessionHandoffPath(nextPath, body.data?.sessionToken, body.csrfToken))
    } catch (caught) {
      // R506のついで: 通信断の技術文言をそのまま出さない。
      setError(twoFactorFailureMessage(caught, '登録を完了できませんでした'))
      setCode('')
    } finally { setBusy(false) }
  }

  return <main className="flex min-h-[100svh] items-center justify-center bg-canvas-sunken px-4 py-8">
    <section className="w-full max-w-md rounded-card bg-canvas px-6 py-8 shadow-card sm:px-10">
      <div className="flex items-center justify-center gap-3 text-sm font-semibold text-ink">
        <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent-soft font-bold text-accent-deep">然</span>
        {brand.name ?? '然-NEN- 公式'}
      </div>
      {/*
        320px では2列がはみ出す（監査 m18e）。狭い幅では1列に積む。
      */}
      <div className="mt-6 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <div className="rounded-control bg-canvas-sunken px-3 py-2 text-success">✓ ログイン</div>
        <div className="rounded-control bg-accent-soft px-3 py-2 font-medium text-accent-deep">2　二段階認証の設定</div>
      </div>
      <div className="mt-7 text-center">
        <h1 className="text-xl font-bold text-ink">二段階認証を設定</h1>
        <p className="mt-2 text-xs text-ink-secondary">
          管理者には二段階認証が必須です。認証アプリ（Google Authenticator など）でQRコードを読み取り、表示された6桁の数字を入れてください。
        </p>
      </div>
      {error && <Notice tone="danger" message={error} className="mt-5" />}
      {expired && (
        <p className="mt-4 text-center text-xs text-ink-secondary">
          表示中のQRコードは使えなくなりました。ログインし直すと新しいQRコードをお出しします。
        </p>
      )}
      {loading ? (
        <p className="mt-6 text-center text-xs text-ink-faint">QRコードを用意しています…</p>
      ) : setup ? (
        <form onSubmit={(event) => void submit(event)} className="mt-6 flex flex-col items-center gap-4">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- 手元で描いた data: URL の QR。最適化の対象ではない
            <img src={qr} alt="認証アプリ登録用のQRコード" className="h-52 w-52 rounded-control border border-hairline" />
          ) : (
            <DelayedSkeleton loading skeleton={<Skeleton className="block h-52 w-52 rounded-control" />} />
          )}
          <div className="text-center">
            <p className="text-xs text-ink-faint">読み取れないときは、このキーを手で入力</p>
            <p className="mt-1 break-all font-mono text-sm font-bold tracking-wider text-ink">{setup.manualKey}</p>
          </div>
          <div className="w-full">
            <label htmlFor="totp-setup-code" className="block text-xs font-semibold text-ink">認証アプリの6桁の数字</label>
            <div className="mt-2">
              {/* ★V7 共通 認証コード入力（xHzFK）。 */}
              <OtpInput id="totp-setup-code" value={code} onChange={setCode} label="認証アプリの6桁の数字" invalid={Boolean(error)} disabled={busy} />
            </div>
          </div>
          <Button type="submit" variant="primary" disabled={busy} className="w-full" busy={busy} busyLabel="確認しています…">確認して登録を完了する
          </Button>
        </form>
      ) : null}
      {!loading && !setup ? (
        expired || !challenge ? (
          <Link href="/login" onClick={clearTwoFactorChallenge} className="mt-6 block text-center text-xs font-medium text-action hover:underline">
            ログインへ戻る
          </Link>
        ) : (
          // M033: 合言葉は生きているので、その場で読み直せる。再ログインは強要しない。
          <div className="mt-6">
            <ListState kind="error" error={setupError ?? undefined} onRetry={() => void loadSetup(challenge, true)} retrying={retrying} />
            <Link href="/login" onClick={clearTwoFactorChallenge} className="mt-4 block text-center text-xs font-medium text-action hover:underline">
              ログインへ戻る
            </Link>
          </div>
        )
      ) : null}
    </section>
  </main>
}
