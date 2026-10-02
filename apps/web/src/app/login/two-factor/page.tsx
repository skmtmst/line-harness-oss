'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { adminSessionHandoffPath, adminSessionHeaders, captureTwoFactorChallenge, captureTwoFactorMethod, clearTwoFactorChallenge, takeTwoFactorNextPath, storeAdminSession, type TwoFactorMethod } from '@/lib/admin-session'
import { useBrand } from '@/lib/use-brand'
import Notice from '@/components/shared/notice'
import OtpInput from '@/components/shared/otp-input'
import { twoFactorFailureMessage } from './two-factor-error'
import Button from '@/components/shared/button'

export default function TwoFactorLoginPage() {
  const [code, setCode] = useState('')
  /* 認証が通ったあと、緑の輪郭（V8 の動き）を見せてから画面を移す。 */
  const [succeeded, setSucceeded] = useState(false)
  /** 失敗のたびに入力欄を作り直し、1マス目へ戻す。 */
  const [attempt, setAttempt] = useState(0)
  const [challenge, setChallenge] = useState('')
  const [method, setMethod] = useState<TwoFactorMethod>('line')
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const brand = useBrand()

  // R507: 方法の受け取りは合言葉の受け取りより先に（合言葉の受け取りで hash が消えるため）。
  useEffect(() => { setMethod(captureTwoFactorMethod()); setChallenge(captureTwoFactorChallenge()); setReady(true) }, [])

  /*
   * R614: ログインからの合言葉引き継ぎなしで直接開いたとき。
   * 足りないのは合言葉であり、認証コードの入力をやり直しても解決しないため、
   * コード不足と案内せず、ログインのやり直しを示す。
   */
  const missingChallenge = ready && !challenge

  /* 成功の印を見せてから画面を移す（V8 の動き。値は MOTION.md の OTP）。 */
  const finish = (href: string) => {
    setSucceeded(true)
    window.setTimeout(() => window.location.assign(href), 420)
  }

  const submit = async () => {
    if (!challenge) return setError('ログインの情報が見つかりませんでした。ログインからやり直してください。')
    if (code.length !== 6) return setError('6桁の認証コードを入力してください')
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
            finish(adminSessionHandoffPath('/ops/two-factor', body.data?.sessionToken, body.csrfToken))
            return
          }
          throw new Error('このアカウントは運営メンバーとして有効ではありません。招待メールのリンクから登録を完了してください')
        }
      }
      clearTwoFactorChallenge()
      finish(adminSessionHandoffPath(nextPath, body.data?.sessionToken, body.csrfToken))
    } catch (caught) {
      // R506: 通信断の技術文言をそのまま出さない。
      setError(twoFactorFailureMessage(caught))
      setCode('')
      setAttempt((current) => current + 1)
    } finally { setLoading(false) }
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
        {/* R507: メール経路ではLINEログイン済みと断定しない。実際の方法を出す。R614: 合言葉なしの直リンクでは済んだことにしない。 */}
        <div className={missingChallenge ? 'rounded-control bg-canvas-sunken px-3 py-2 text-ink-secondary' : 'rounded-control bg-canvas-sunken px-3 py-2 text-success'}>{missingChallenge ? 'ログイン' : method === 'password' ? '✓ メールログイン' : '✓ LINEログイン'}</div>
        <div className="rounded-control bg-accent-soft px-3 py-2 font-medium text-accent-deep">2　二段階認証</div>
      </div>
      <div className="mt-7 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-pill bg-accent-soft text-accent-deep">♢</div>
        <h1 className="mt-3 text-xl font-bold text-ink">二段階認証</h1>
        <p className="mt-2 text-xs text-ink-secondary">認証アプリに表示されている6桁コードを入力してください</p>
      </div>
      {/* R614: 帯は1本。合言葉なしは読み直し対象の案内なので青で出し、赤は使わない。 */}
      {missingChallenge
        ? <Notice tone="info" message="ログインの情報が見つかりませんでした。ログインからやり直してください。" id="two-factor-missing" className="mt-5" />
        : error ? <Notice tone="danger" message={error} id="two-factor-error" className="mt-5" /> : null}
      <p id="two-factor-code-label" className="mt-6 block text-xs font-semibold text-ink">認証コード</p>
      {/* ★V7 共通 認証コード入力（xHzFK）。貼り付け・自動入力も6マスへ振り分ける。 */}
      <div className="mt-2 flex justify-center">
        <OtpInput
          key={attempt}
          value={code}
          onChange={(next) => { setCode(next); if (error) setError('') }}
          labelledBy="two-factor-code-label"
          describedBy={missingChallenge ? 'two-factor-missing' : error ? 'two-factor-error' : undefined}
          invalid={Boolean(error)}
          success={succeeded}
          disabled={loading || missingChallenge || succeeded}
          autoFocus
        />
      </div>
      <p className="mt-2 text-xs text-ink-faint">◷ コードは約30秒ごとに更新されます</p>
      {/* R614: 合言葉なしでは押せない（V8移行後も共通Buttonで条件を維持）。 */}
      <Button variant="primary" className="mt-6 h-12 w-full font-bold disabled:opacity-50 border-0 whitespace-normal" onClick={() => void submit()} disabled={loading || missingChallenge || succeeded || code.length !== 6}>{loading || succeeded ? '確認中…' : '確認してログイン'}</Button>
      <p className="mt-5 text-center text-xs text-ink-secondary">コードを入力できない場合</p>
      {/* R507残部: メール経路と合言葉なし直リンクの戻り先はLINEに限定しない。LINE経路は既存どおり。 */}
      <Link href="/login" onClick={clearTwoFactorChallenge} className="mt-2 block text-center text-xs font-medium text-action hover:underline">{missingChallenge || method === 'password' ? 'ログインに戻る' : '別のLINEアカウントでログイン'}</Link>
    </section>
  </main>
}
