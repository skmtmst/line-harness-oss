'use client'

import QRCode from 'qrcode'
import { useEffect, useState, type FormEvent } from 'react'
import AuthCard, { AuthField } from '@/components/auth/auth-card'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { TextField } from '@/components/shared/text-field'
import { adminSessionHeaders } from '@/lib/admin-session'
import { api } from '@/lib/api'
import { logoutAndGoToLogin } from '@/lib/logout'

/**
 * 運営コンソールの 2要素認証の設定（★V6 37-10-B `NAJKx`）。
 *
 * - 招待を受けた人（awaiting_totp）はここを通るまで運営メンバーにならない
 * - 登録済みで未設定の人（既存の 3 名など）も、左下メニューの「2要素認証の設定」からここへ来る
 * 確認が通るとサーバーは安全のためログインを解除するので、ログインし直しを案内する。
 */
type Session = { id: string; name: string; platformAdmin?: boolean; platformAdminState?: string | null }

export default function OpsTwoFactorPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'done' | 'denied'>('loading')
  const [uri, setUri] = useState('')
  const [manualKey, setManualKey] = useState('')
  const [qr, setQr] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    void (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/auth/session`, { credentials: 'include', headers: adminSessionHeaders() })
        if (!res.ok) throw new Error('unauthenticated')
        const body = await res.json() as { success?: boolean; data?: Session; csrfToken?: string }
        if (!body.success || !body.data) throw new Error('unauthenticated')
        if (body.csrfToken) localStorage.setItem('lh_csrf', body.csrfToken)
        if (cancelled) return
        // 運営メンバー（登録済み）か、2要素認証待ちの人だけ
        if (!body.data.platformAdmin && body.data.platformAdminState !== 'awaiting_totp') { setState('denied'); return }
        setSession(body.data)
        const setup = await api.staff.beginTwoFactorSetup(body.data.id)
        if (cancelled) return
        if (!setup.success) { setError(setup.error || 'QRコードを用意できませんでした'); setState('ready'); return }
        setUri(setup.data.provisioningUri)
        setManualKey(setup.data.manualKey)
        setState('ready')
      } catch {
        if (!cancelled) window.location.assign('/ops/login')
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!uri) return
    void QRCode.toDataURL(uri, { width: 200, margin: 1 }).then(setQr)
  }, [uri])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!session || busy) return
    const digits = code.replace(/\D/g, '')
    if (digits.length !== 6) { setError('6桁の数字を入力してください'); return }
    setBusy(true)
    setError('')
    const res = await api.staff.confirmTwoFactorSetup(session.id, digits)
    setBusy(false)
    if (!res.success) { setError(res.error || '認証コードが正しくありません'); return }
    setState('done')
  }

  return (
    <AuthCard
      node="NAJKx"
      cardNode="ckBzA"
      title="2要素認証を設定"
      description={
        <>
          <span className="mb-1 block text-caption font-bold text-ink-faint">運営コンソール</span>
          運営コンソールは2要素認証が必須です。認証アプリ（Google Authenticator など）でQRコードを読み取り、表示された6桁の数字を入れてください。確認が通ると登録が完了します。
        </>
      }
    >
      {state === 'loading' ? (
        <ListState kind="loading" title="準備しています" />
      ) : state === 'denied' ? (
        <div className="flex w-full flex-col gap-4">
          <ListState kind="forbidden" title="この画面は運営メンバーだけが開けます" description="招待メールのリンクから進んでください。" />
          <Button href="/ops/login" className="w-full">運営のログインへ</Button>
        </div>
      ) : state === 'done' ? (
        <div className="flex w-full flex-col gap-4">
          <NoteBar tone="info">2要素認証を登録しました。安全のため一度ログアウトしています。メールとパスワード、次に6桁の数字でログインし直してください。</NoteBar>
          <Button variant="primary" onClick={() => void logoutAndGoToLogin('/ops/login')} className="w-full">運営のログインへ</Button>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate className="flex w-full flex-col items-center gap-4">
          {error ? (
            <p role="alert" className="w-full rounded-control bg-status-danger-soft px-4 py-3 text-label text-status-danger">{error}</p>
          ) : null}
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- 手元で描いた data: URL の QR。最適化の対象ではない
            <img src={qr} alt="認証アプリ登録用のQRコード" className="h-52 w-52 rounded-control border border-hairline" />
          ) : (
            <div className="h-52 w-52 animate-pulse rounded-control bg-canvas-sunken" aria-hidden="true" />
          )}
          <div className="text-center">
            <p className="text-caption text-ink-faint">読み取れないときは、このキーを手で入力</p>
            <p className="mt-1 break-all font-mono text-label font-bold tracking-wider text-ink">{manualKey || '—'}</p>
          </div>
          <div className="w-full">
            <AuthField label="認証アプリの6桁の数字" htmlFor="ops-totp-code">
              <TextField id="ops-totp-code" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" />
            </AuthField>
          </div>
          <Button type="submit" variant="primary" disabled={busy || !uri} className="w-full">
            {busy ? '確認しています…' : '確認して登録を完了する'}
          </Button>
          <p className="text-center text-caption text-ink-faint">
            確認が通ると、安全のため一度ログアウトします。メールとパスワード、次に6桁の数字でログインし直してください
          </p>
        </form>
      )}
    </AuthCard>
  )
}
