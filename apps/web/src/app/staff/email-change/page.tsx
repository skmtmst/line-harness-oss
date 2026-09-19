'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import { api } from '@/lib/api'

/*
 * メールアドレス変更の確認画面（N-433）。
 *
 * 招待の確認画面（/staff/invite）と同じ構え。メール内リンクは
 * `#token=` の fragment に秘密を乗せるので、アクセスログには残らない。
 * 確定はこの画面のボタンからの POST だけが行う。メールの先読みや
 * ブラウザのプリフェッチで勝手に確定しない。
 */
type ViewState = 'reading' | 'ready' | 'submitting' | 'complete' | 'invalid'

export default function StaffEmailChangePage() {
  const [token, setToken] = useState('')
  const [view, setView] = useState<ViewState>('reading')
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const changeToken = params.get('token')?.trim() ?? ''
    // 秘密の確認情報を履歴・コピー後のURLへ残さない。
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    setToken(changeToken)
    setView(changeToken ? 'ready' : 'invalid')
  }, [])

  const applyChange = async () => {
    if (!token || view === 'submitting') return
    setView('submitting')
    setError('')
    try {
      const result = await api.staff.confirmEmailChange(token)
      if (!result.success) {
        setError(result.error)
        setView('ready')
        return
      }
      setToken('')
      setView('complete')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'メールアドレスの変更を確定できませんでした。')
      setView('ready')
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-16">
      <section className="w-full rounded-card border border-hairline bg-canvas p-8 shadow-sm">
        <p className="text-sm font-semibold text-accent-deep">然-NEN- LINE管理システム</p>
        <div role="heading" aria-level={1} className="mt-3 text-2xl font-bold text-ink">メールアドレスの変更</div>

        {view === 'reading' && <p className="mt-5 text-sm text-ink-secondary">確認内容を読み込んでいます…</p>}
        {view === 'invalid' && (
          <p role="alert" className="mt-5 rounded-control bg-danger-bg p-4 text-sm text-danger">
            確認情報が見つかりません。確認メールのリンクをもう一度開いてください。
          </p>
        )}
        {(view === 'ready' || view === 'submitting') && (
          <>
            <p className="mt-5 text-sm leading-7 text-ink-secondary">
              「変更を確定する」を押すと、このメールアドレスへの変更が完了します。
            </p>
            {error && <p role="alert" className="mt-4 rounded-control bg-danger-bg p-4 text-sm text-danger">{error}</p>}
            <div className="mt-6">
              <Button type="button" variant="primary" disabled={view === 'submitting'} onClick={() => void applyChange()}>
                {view === 'submitting' ? '確定中…' : '変更を確定する'}
              </Button>
            </div>
          </>
        )}
        {view === 'complete' && (
          <div className="mt-5 rounded-control border border-accent bg-accent-soft p-5">
            <p className="font-bold text-accent-deep">メールアドレスを変更しました</p>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">次回から新しいメールアドレスが使われます。</p>
          </div>
        )}
      </section>
    </main>
  )
}
