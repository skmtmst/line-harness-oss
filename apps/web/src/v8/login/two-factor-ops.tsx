'use client'

/*
 * ★V8-B 運営 ログイン 2段目（板 `tOPeY`「6桁の確認」）。
 *
 * 運営のログイン（/ops/login）でパスワードを確かめたあと、`/login/two-factor?next=ops#lh_2fa=…`
 * で来たときだけ出す。動き（合言葉の受け取り・確認の口・運営権限の確かめ・失敗の文）は
 * v7 の app/login/two-factor/page.tsx と同じ。見た目だけ絵どおりに1枚のカードへまとめた。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LogIn } from 'lucide-react'
import {
  adminSessionHandoffPath,
  adminSessionHeaders,
  captureTwoFactorChallenge,
  captureTwoFactorMethod,
  clearTwoFactorChallenge,
  storeAdminSession,
  takeTwoFactorNextPath,
} from '@/lib/admin-session'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import OtpInput from '@/components/shared/otp-input'
import styles from './two-factor-ops.module.css'

/* 通信断・JSON でない返事は技術文言を出さない（v7 の two-factor-error と同じ決まりを写した）。 */
export function opsTwoFactorFailureMessage(caught: unknown, fallback = '認証できませんでした'): string {
  const message = caught instanceof Error ? caught.message : ''
  if (caught instanceof TypeError || /Failed to fetch|NetworkError|Load failed|Network request failed/i.test(message)) {
    return '通信が切れています。接続を確かめて、もう一度お試しください。'
  }
  if (caught instanceof Error && caught.message) {
    if (caught instanceof SyntaxError) return fallback
    return caught.message
  }
  return fallback
}

export default function OpsTwoFactorV8() {
  const [code, setCode] = useState('')
  const [succeeded, setSucceeded] = useState(false)
  /** 失敗のたびに6マスを作り直し、1マス目へ戻す。 */
  const [attempt, setAttempt] = useState(0)
  const [challenge, setChallenge] = useState('')
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 方法の受け取りは合言葉より先に（合言葉の受け取りで hash が消えるため。v7 と同じ順）。
  useEffect(() => { captureTwoFactorMethod(); setChallenge(captureTwoFactorChallenge()); setReady(true) }, [])

  const missingChallenge = ready && !challenge

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
        try { localStorage.setItem('lh_csrf', body.csrfToken) } catch { /* Cookie のセッションで足りる */ }
      }
      const nextPath = takeTwoFactorNextPath()
      // 運営へ戻す前に、セッションと運営権限を確かめる（省くと /ops/login との往復になる）。
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
      setError(opsTwoFactorFailureMessage(caught))
      setCode('')
      setAttempt((current) => current + 1)
    } finally { setLoading(false) }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} data-design-node="tOPeY" aria-labelledby="ops-two-factor-title">
        <h1 id="ops-two-factor-title" className={styles.title}>6桁の確認</h1>
        <p className={styles.desc}>パスワードを確かめました。認証アプリに出ている6桁を入れてください。</p>
        {missingChallenge ? (
          <Notice tone="info" id="ops-two-factor-missing" message="ログインの情報が見つかりませんでした。ログインからやり直してください。" action={<Link href="/ops/login" onClick={clearTwoFactorChallenge}>ログインに戻る</Link>} />
        ) : error ? <Notice tone="danger" id="ops-two-factor-error" message={error} /> : null}
        <div className={styles.field}>
          <p id="ops-two-factor-code-label" className={styles.label}>認証コード（6桁）</p>
          <OtpInput
            key={attempt}
            value={code}
            onChange={(next) => { setCode(next); if (error) setError('') }}
            labelledBy="ops-two-factor-code-label"
            describedBy={missingChallenge ? 'ops-two-factor-missing' : error ? 'ops-two-factor-error' : undefined}
            invalid={Boolean(error)}
            success={succeeded}
            disabled={loading || missingChallenge || succeeded}
            autoFocus
          />
        </div>
        <Button
          variant="primary"
          className={styles.submit}
          onClick={() => void submit()}
          disabled={loading || missingChallenge || succeeded}
          busy={loading || succeeded}
          busyLabel="確認しています…"
        >
          <LogIn aria-hidden="true" className={styles.icon} />ログイン
        </Button>
        <p className={styles.foot}>認証アプリが使えないときは、運営のオーナーに連絡してください。</p>
      </section>
    </main>
  )
}
