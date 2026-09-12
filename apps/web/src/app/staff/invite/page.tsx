'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import { api } from '@/lib/api'

type ViewState = 'reading' | 'ready' | 'submitting' | 'complete' | 'invalid'

export default function StaffInvitationPage() {
  const [token, setToken] = useState('')
  const [view, setView] = useState<ViewState>('reading')
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const invitation = params.get('invite')?.trim() ?? ''
    // 秘密の招待情報を履歴・コピー後のURLへ残さない。
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    setToken(invitation)
    setView(invitation ? 'ready' : 'invalid')
  }, [])

  const accept = async () => {
    if (!token || view === 'submitting') return
    setView('submitting')
    setError('')
    try {
      const result = await api.staff.acceptInvitation(token)
      if (!result.success) {
        setError(result.error)
        setView('ready')
        return
      }
      setToken('')
      setView('complete')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '招待を確認できませんでした。')
      setView('ready')
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-16">
      <section className="w-full rounded-card border border-hairline bg-canvas p-8 shadow-sm">
        <p className="text-sm font-semibold text-accent-deep">然-NEN- LINE管理システム</p>
        <div role="heading" aria-level={1} className="mt-3 text-2xl font-bold text-ink">管理画面への招待</div>

        {view === 'reading' && <p className="mt-5 text-sm text-ink-secondary">招待内容を確認しています…</p>}
        {view === 'invalid' && (
          <p role="alert" className="mt-5 rounded-control bg-danger-bg p-4 text-sm text-danger">
            招待情報が見つかりません。招待メールのリンクをもう一度開いてください。
          </p>
        )}
        {(view === 'ready' || view === 'submitting') && (
          <>
            <p className="mt-5 text-sm leading-7 text-ink-secondary">
              「参加する」を押すとメールアドレスの確認が完了します。続いて届くメールからLINE連携を行ってください。
            </p>
            {error && <p role="alert" className="mt-4 rounded-control bg-danger-bg p-4 text-sm text-danger">{error}</p>}
            <div className="mt-6">
              <Button type="button" variant="primary" disabled={view === 'submitting'} onClick={() => void accept()}>
                {view === 'submitting' ? '確認中…' : '参加する'}
              </Button>
            </div>
          </>
        )}
        {view === 'complete' && (
          <div className="mt-5 rounded-control border border-accent bg-accent-soft p-5">
            <p className="font-bold text-accent-deep">メールアドレスを確認しました</p>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">続いて届くメールからLINE連携を完了してください。</p>
          </div>
        )}
      </section>
    </main>
  )
}
