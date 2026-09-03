'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { captureTwoFactorChallenge, clearTwoFactorChallenge, storeAdminSession } from '@/lib/admin-session'
import { useBrand } from '@/lib/use-brand'

export default function TwoFactorLoginPage() {
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [challenge, setChallenge] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const brand = useBrand()

  useEffect(() => setChallenge(captureTwoFactorChallenge()), [])

  const submit = async () => {
    const code = digits.join('')
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
      else if (body.csrfToken) localStorage.setItem('lh_csrf', body.csrfToken)
      clearTwoFactorChallenge()
      window.location.assign('/')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '認証できませんでした')
      setDigits(['', '', '', '', '', ''])
      refs.current[0]?.focus()
    } finally { setLoading(false) }
  }

  const changeDigit = (index: number, value: string) => {
    const numeric = value.replace(/\D/g, '').slice(-1)
    setDigits((current) => current.map((digit, i) => i === index ? numeric : digit))
    if (numeric && index < 5) refs.current[index + 1]?.focus()
  }

  return <main className="flex min-h-[100svh] items-center justify-center bg-canvas-sunken px-4 py-8">
    <section className="w-full max-w-md rounded-card bg-canvas px-6 py-8 shadow-sm sm:px-10">
      <div className="flex items-center justify-center gap-3 text-sm font-semibold text-ink">
        <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent-soft font-bold text-accent">然</span>
        {brand.name ?? '然-NEN- 公式'}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-control bg-canvas-sunken px-3 py-2 text-success">✓ LINEログイン</div>
        <div className="rounded-control bg-accent-soft px-3 py-2 font-medium text-accent">2　二段階認証</div>
      </div>
      <div className="mt-7 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">♢</div>
        <h1 className="mt-3 text-xl font-bold text-ink">二段階認証</h1>
        <p className="mt-2 text-xs text-ink-secondary">認証アプリに表示されている6桁コードを入力してください</p>
      </div>
      {error && <p className="mt-5 rounded-control bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      <label className="mt-6 block text-xs font-semibold text-ink">認証コード</label>
      <div className="mt-2 grid grid-cols-6 gap-2" onPaste={(event) => {
        const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
        if (pasted.length === 6) { event.preventDefault(); setDigits(pasted.split('')); refs.current[5]?.focus() }
      }}>
        {digits.map((digit, index) => <input key={index} ref={(node) => { refs.current[index] = node }} value={digit} inputMode="numeric" autoComplete="one-time-code" aria-label={`認証コード${index + 1}桁目`} onChange={(event) => changeDigit(index, event.target.value)} onKeyDown={(event) => { if (event.key === 'Backspace' && !digit && index > 0) refs.current[index - 1]?.focus() }} className="h-12 min-w-0 rounded-control border border-hairline text-center text-xl font-bold outline-none focus:border-accent" />)}
      </div>
      <p className="mt-2 text-xs text-ink-faint">◷ コードは約30秒ごとに更新されます</p>
      <button onClick={() => void submit()} disabled={loading || digits.some((digit) => !digit)} className="mt-6 h-12 w-full cursor-pointer rounded-control bg-accent-deep font-bold text-on-accent hover:brightness-92 disabled:cursor-not-allowed disabled:opacity-50">{loading ? '確認中…' : '確認してログイン'}</button>
      <p className="mt-5 text-center text-xs text-ink-secondary">コードを入力できない場合</p>
      <Link href="/login" onClick={clearTwoFactorChallenge} className="mt-2 block text-center text-xs font-medium text-accent hover:underline">別のLINEアカウントでログイン</Link>
    </section>
  </main>
}
