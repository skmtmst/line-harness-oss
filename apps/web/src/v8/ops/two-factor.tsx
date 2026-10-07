'use client'

import { Check, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Notice from '@/components/shared/notice'
import OtpInput from '@/components/shared/otp-input'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { adminSessionHeaders, captureAdminSessionHandoff } from '@/lib/admin-session'
import { api } from '@/lib/api'
import { logoutAndGoToLogin } from '@/lib/logout'
import { qrToDataURL } from '@/lib/qr-image'
import { opsCall } from '@/components/ops/ops-ui'
import styles from './auth.module.css'

type Session = { id: string; name: string; platformAdmin?: boolean; platformAdminState?: string | null }

/**
 * 運営コンソールの 2要素認証の設定 V8（絵 `qod6X`）。
 *
 * 動きは v7（app/ops/two-factor）と同じ。招待を受けた人（awaiting_totp）と、
 * 登録済みで未設定の運営メンバーだけが開ける。確認が通るとサーバーが
 * ログインを解除するので、ログインし直しを案内する。
 */
export default function OpsTwoFactorV8() {
  const [session, setSession] = useState<Session | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'done' | 'denied'>('loading')
  const [uri, setUri] = useState('')
  const [manualKey, setManualKey] = useState('')
  const [qr, setQr] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [qrFailed, setQrFailed] = useState(false)
  const [qrAttempt, setQrAttempt] = useState(0)
  const cancelledRef = useRef(false)

  const load = useCallback(async () => {
    setError('')
    setQrFailed(false)
    setState('loading')
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    try {
      const handoffToken = captureAdminSessionHandoff()
      const res = await fetch(`${apiUrl}/api/auth/session`, { credentials: 'include', headers: adminSessionHeaders(handoffToken) })
      if (!res.ok) throw new Error('unauthenticated')
      const body = await res.json() as { success?: boolean; data?: Session; csrfToken?: string }
      if (!body.success || !body.data) throw new Error('unauthenticated')
      if (body.csrfToken) localStorage.setItem('lh_csrf', body.csrfToken)
      if (cancelledRef.current) return
      if (!body.data.platformAdmin && body.data.platformAdminState !== 'awaiting_totp') { setState('denied'); return }
      setSession(body.data)
      // QR の準備の失敗はログイン切れではない。ログイン中のまま理由と取り直しを出す。
      let setup: Awaited<ReturnType<typeof api.staff.beginTwoFactorSetup>> | null = null
      try {
        setup = await api.staff.beginTwoFactorSetup(body.data.id)
      } catch {
        setup = null
      }
      if (cancelledRef.current) return
      if (!setup || !setup.success) {
        setError(!setup || typeof setup.error !== 'string' || !setup.error ? 'QRコードを用意できませんでした' : setup.error)
        setState('ready')
        return
      }
      setUri(setup.data.provisioningUri)
      setManualKey(setup.data.manualKey)
      setState('ready')
    } catch {
      if (!cancelledRef.current) window.location.assign('/ops/login')
    }
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    void load()
    return () => { cancelledRef.current = true }
  }, [load])

  useEffect(() => {
    if (!uri) return
    let cancelled = false
    setQr('')
    setQrFailed(false)
    void qrToDataURL(uri, { width: 200, margin: 1 })
      .then((data) => { if (!cancelled) setQr(data) })
      .catch(() => { if (!cancelled) setQrFailed(true) })
    return () => { cancelled = true }
  }, [uri, qrAttempt])

  const digits = code.replace(/\D/g, '')
  const codeComplete = digits.length === 6

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!session || busy) return
    if (digits.length !== 6) { setError('6桁の数字を入力してください'); return }
    setBusy(true)
    setError('')
    const res = await opsCall(api.staff.confirmTwoFactorSetup(session.id, digits))
    setBusy(false)
    if (!res.success) { setError(res.error || '認証コードが正しくありません'); return }
    setState('done')
  }

  return (
    <main className={styles.page} data-design-node="qod6X">
      <div className={styles.brand}>
        <span className={styles.mark} aria-hidden="true">m</span>
        <span className={styles.brandText}>
          <span className={styles.brandName}>musubo</span>
          <span className={styles.brandSub}>運営コンソール</span>
        </span>
      </div>
      <section className={styles.card} aria-labelledby="ops-totp-title">
        <h1 id="ops-totp-title" className={styles.title}>2要素認証を設定</h1>
        <p className={styles.lead}>認証アプリ（Google Authenticator など）で QR を読み取り、表示された6桁を入れます。</p>
        {state === 'loading' ? (
          <ListState kind="loading" title="準備しています" />
        ) : state === 'denied' ? (
          <>
            <ListState kind="forbidden" title="この画面は運営メンバーだけが開けます" description="招待メールのリンクから進んでください。" />
            <Button href="/ops/login" className={styles.wide}>運営のログインへ</Button>
          </>
        ) : state === 'done' ? (
          <>
            <NoteBar tone="info">2要素認証を登録しました。安全のため一度ログアウトしています。メールとパスワード、次に6桁の数字でログインし直してください。</NoteBar>
            <Button variant="primary" onClick={() => void logoutAndGoToLogin('/ops/login')} className={styles.wide}>運営のログインへ</Button>
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)} noValidate className={styles.form}>
            {error ? <Notice tone="danger" message={error} /> : null}
            {error && !uri ? <Button onClick={() => void load()} className={styles.wide}>もう一度読み込む</Button> : null}
            <div className={styles.qrRow}>
              <div className={styles.qr}>
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 手元で描いた data: URL の QR。最適化の対象ではない
                  <img src={qr} alt="認証アプリ登録用のQRコード" />
                ) : qrFailed ? (
                  <p role="alert" className={styles.error}>QRコードを表示できませんでした</p>
                ) : (
                  <DelayedSkeleton loading skeleton={<Skeleton className="block h-full w-full" />} />
                )}
              </div>
              <div className={styles.qrSide}>
                <p className={styles.qrHint}>読み取れないときは、このキーを手で入力</p>
                <p className={styles.secret}>{manualKey || '—'}</p>
                <Button onClick={() => setQrAttempt((n) => n + 1)} disabled={!uri}>
                  <RefreshCw aria-hidden="true" />QRをもう一度表示する
                </Button>
              </div>
            </div>
            <div className={styles.field}>
              <span id="ops-totp-label" className={styles.label}>認証コード（6桁）</span>
              <OtpInput id="ops-totp-code" value={code} onChange={setCode} labelledBy="ops-totp-label" invalid={Boolean(error)} disabled={busy} />
            </div>
            <Button type="submit" variant="primary" disabled={busy || !uri || !codeComplete} className={styles.wide} busy={busy} busyLabel="確認しています…">
              <Check aria-hidden="true" />登録する
            </Button>
            <p className={styles.note}>登録すると安全のため一度ログアウトします。メールとパスワード、次に6桁の数字でログインし直してください。</p>
          </form>
        )}
      </section>
      <p className={styles.foot}>この画面は運営メンバーだけが開けます。操作はすべて記録されます。</p>
    </main>
  )
}
