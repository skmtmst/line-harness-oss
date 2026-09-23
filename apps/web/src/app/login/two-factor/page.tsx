'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { adminSessionHandoffPath, adminSessionHeaders, captureTwoFactorChallenge, clearTwoFactorChallenge, takeTwoFactorNextPath, storeAdminSession } from '@/lib/admin-session'
import { useBrand } from '@/lib/use-brand'
import OtpInput from '@/components/shared/otp-input'

export default function TwoFactorLoginPage() {
  const [code, setCode] = useState('')
  /** 失敗のたびに入力欄を作り直し、1マス目へ戻す。 */
  const [attempt, setAttempt] = useState(0)
  const [challenge, setChallenge] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const brand = useBrand()

  useEffect(() => setChallenge(captureTwoFactorChallenge()), [])

  const submit = async () => {
    if (!challenge || code.length !== 6) return setError('6桁の認証コードを入力してください')
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/two-factor/verify`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: challenge, code }),
      })
      const body = await response.json() as { success: boolean; error?: string; data?: { sessionToken?: string }; csrfToken?: string }
      if (!response.ok || !body.success) throw new Error(body.error || '認証できませんでした')
      if (body.data?.sessionToken) storeAdminSession(body.data.sessionToken, body.csrfToken)
      else if (body.csrfToken) {
        try { localStorage.setItem('lh_csrf', body.csrfToken) } catch { /* Cookie session is sufficient */ }
      }
      const nextPath = takeTwoFactorNextPath()
      // 運営ログインは、遷移前に session と運営権限を確かめる。ここを省くと
      // 認可失敗まで「成功」に見え、/ops/login との往復ループになる。
      if (nextPath === '/ops') {
        const session = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/session`, {
          credentials: 'include',
          headers: adminSessionHeaders(body.data?.sessionToken),
        })
        const sessionBody = await session.json().catch(() => ({})) as { success?: boolean; data?: { platformAdmin?: boolean; platformAdminState?: string | null } }
        if (!session.ok || !sessionBody.success || !sessionBody.data) {
          throw new Error('ログイン状態を確認できませんでした。もう一度ログインしてください')
        }
        if (!sessionBody.data.platformAdmin) {
          if (sessionBody.data.platformAdminState === 'awaiting_totp') {
            clearTwoFactorChallenge()
            window.location.assign(adminSessionHandoffPath('/ops/two-factor', body.data?.sessionToken, body.csrfToken))
            return
          }
          throw new Error('このアカウントは運営メンバーとして有効ではありません。招待メールのリンクから登録を完了してください')
        }
      }
      clearTwoFactorChallenge()
      window.location.assign(adminSessionHandoffPath(nextPath, body.data?.sessionToken, body.csrfToken))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '認証できませんでした')
      setCode('')
      setAttempt((current) => current + 1)
    } finally { setLoading(false) }
  }

  return <main className="flex min-h-[100svh] items-center justify-center bg-canvas-sunken px-4 py-8">
    <section className="w-full max-w-md rounded-card bg-canvas px-6 py-8 shadow-sm sm:px-10">
      <div className="flex items-center justify-center gap-3 text-sm font-semibold text-ink">
        <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent-soft font-bold text-accent-deep">然</span>
        {brand.name ?? '然-NEN- 公式'}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-control bg-canvas-sunken px-3 py-2 text-success">✓ LINEログイン</div>
        <div className="rounded-control bg-accent-soft px-3 py-2 font-medium text-accent-deep">2　二段階認証</div>
      </div>
      <div className="mt-7 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent-deep">♢</div>
        <h1 className="mt-3 text-xl font-bold text-ink">二段階認証</h1>
        <p className="mt-2 text-xs text-ink-secondary">認証アプリに表示されている6桁コードを入力してください</p>
      </div>
      {error && <p id="two-factor-error" role="alert" className="mt-5 rounded-control bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      <p id="two-factor-code-label" className="mt-6 block text-xs font-semibold text-ink">認証コード</p>
      {/* ★V7 共通 認証コード入力（xHzFK）。貼り付け・自動入力も6マスへ振り分ける。 */}
      <div className="mt-2 flex justify-center">
        <OtpInput
          key={attempt}
          value={code}
          onChange={(next) => { setCode(next); if (error) setError('') }}
          labelledBy="two-factor-code-label"
          describedBy={error ? 'two-factor-error' : undefined}
          invalid={Boolean(error)}
          disabled={loading}
          autoFocus
        />
      </div>
      <p className="mt-2 text-xs text-ink-faint">◷ コードは約30秒ごとに更新されます</p>
      <button onClick={() => void submit()} disabled={loading || code.length !== 6} className="mt-6 h-12 w-full cursor-pointer rounded-control bg-accent-deep font-bold text-on-accent hover:brightness-92 disabled:cursor-not-allowed disabled:opacity-50">{loading ? '確認中…' : '確認してログイン'}</button>
      <p className="mt-5 text-center text-xs text-ink-secondary">コードを入力できない場合</p>
      <Link href="/login" onClick={clearTwoFactorChallenge} className="mt-2 block text-center text-xs font-medium text-accent-deep hover:underline">別のLINEアカウントでログイン</Link>
    </section>
  </main>
}
