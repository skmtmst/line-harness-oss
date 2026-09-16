'use client'

import QRCode from 'qrcode'
import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import Button from '@/components/shared/button'
import { TextField } from '@/components/shared/text-field'
import { captureTwoFactorChallenge, clearTwoFactorChallenge, storeAdminSession, takeTwoFactorNextPath } from '@/lib/admin-session'
import { useBrand } from '@/lib/use-brand'

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
  const brand = useBrand()

  useEffect(() => {
    const token = captureTwoFactorChallenge()
    setChallenge(token)
    if (!token) {
      setError('設定の合言葉がありません。ログインからやり直してください')
      setLoading(false)
      return
    }
    void (async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/two-factor/setup`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challengeToken: token }),
        })
        const body = await response.json() as { success: boolean; error?: string; data?: SetupData }
        if (!response.ok || !body.success || !body.data) throw new Error(body.error || '設定を始められませんでした')
        setSetup(body.data)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '設定を始められませんでした')
      } finally { setLoading(false) }
    })()
  }, [])

  useEffect(() => {
    if (!setup?.provisioningUri) return
    void QRCode.toDataURL(setup.provisioningUri, { width: 200, margin: 1 }).then(setQr)
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
      if (!response.ok || !body.success) throw new Error(body.error || '登録を完了できませんでした')
      if (body.data?.sessionToken) storeAdminSession(body.data.sessionToken, body.csrfToken)
      else if (body.csrfToken) localStorage.setItem('lh_csrf', body.csrfToken)
      clearTwoFactorChallenge()
      window.location.assign(takeTwoFactorNextPath())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登録を完了できませんでした')
      setCode('')
    } finally { setBusy(false) }
  }

  return <main className="flex min-h-[100svh] items-center justify-center bg-canvas-sunken px-4 py-8">
    <section className="w-full max-w-md rounded-card bg-canvas px-6 py-8 shadow-sm sm:px-10">
      <div className="flex items-center justify-center gap-3 text-sm font-semibold text-ink">
        <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent-soft font-bold text-accent">然</span>
        {brand.name ?? '然-NEN- 公式'}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-control bg-canvas-sunken px-3 py-2 text-success">✓ ログイン</div>
        <div className="rounded-control bg-accent-soft px-3 py-2 font-medium text-accent">2　二段階認証の設定</div>
      </div>
      <div className="mt-7 text-center">
        <h1 className="text-xl font-bold text-ink">二段階認証を設定</h1>
        <p className="mt-2 text-xs text-ink-secondary">
          管理者には二段階認証が必須です。認証アプリ（Google Authenticator など）でQRコードを読み取り、表示された6桁の数字を入れてください。
        </p>
      </div>
      {error && <p role="alert" className="mt-5 rounded-control bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      {loading ? (
        <p className="mt-6 text-center text-xs text-ink-faint">QRコードを用意しています…</p>
      ) : setup ? (
        <form onSubmit={(event) => void submit(event)} className="mt-6 flex flex-col items-center gap-4">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- 手元で描いた data: URL の QR。最適化の対象ではない
            <img src={qr} alt="認証アプリ登録用のQRコード" className="h-52 w-52 rounded-control border border-hairline" />
          ) : (
            <div className="h-52 w-52 animate-pulse rounded-control bg-canvas-sunken" aria-hidden="true" />
          )}
          <div className="text-center">
            <p className="text-xs text-ink-faint">読み取れないときは、このキーを手で入力</p>
            <p className="mt-1 break-all font-mono text-sm font-bold tracking-wider text-ink">{setup.manualKey}</p>
          </div>
          <div className="w-full">
            <label htmlFor="totp-setup-code" className="block text-xs font-semibold text-ink">認証アプリの6桁の数字</label>
            <div className="mt-2">
              <TextField id="totp-setup-code" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" />
            </div>
          </div>
          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            {busy ? '確認しています…' : '確認して登録を完了する'}
          </Button>
        </form>
      ) : null}
      {!loading && !setup ? (
        <Link href="/login" onClick={clearTwoFactorChallenge} className="mt-6 block text-center text-xs font-medium text-accent hover:underline">
          ログインへ戻る
        </Link>
      ) : null}
    </section>
  </main>
}
