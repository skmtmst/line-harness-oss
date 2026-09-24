'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import HqAccountList from '@/components/hq/account-list'
import Button from '@/components/shared/button'
import { useAccount, type AccountWithStats } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { resolveHqOpenTarget, type HqOpenTarget } from '@/lib/hq-navigation'

export default function HqOpenPage() {
  const router = useRouter()
  const { setSelectedAccountId } = useAccount()
  const [target, setTarget] = useState<HqOpenTarget | null>(null)
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const resolved = resolveHqOpenTarget(new URLSearchParams(window.location.search).get('target'))
    if (!resolved) {
      router.replace('/hq')
      return
    }
    setTarget(resolved)
  }, [router])

  useEffect(() => {
    if (!target) return
    let cancelled = false
    void api.lineAccounts.list()
      .then((response) => {
        if (cancelled) return
        if (!response.success) throw new Error(response.error)
        setAccounts(response.data as AccountWithStats[])
      })
      .catch(() => {
        if (!cancelled) setError('アカウント情報を読み込めませんでした。時間をおいてもう一度お試しください。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [target, reloadKey])

  const openStorePage = (accountId: string) => {
    if (!target) return
    setSelectedAccountId(accountId)
    router.push(target.destination)
  }

  if (!target) {
    return (
      <div className="flex min-h-64 items-center justify-center" role="status" aria-label="移動先を確認中">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-hairline border-t-accent" />
      </div>
    )
  }

  return (
    <div>
      <header data-design="Head" className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-secondary">統括コンソール</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">どのアカウントの{target.label}を開きますか</h1>
          <p className="mt-1 text-sm text-ink-secondary">アカウントを選ぶと、そのアカウントの管理画面へ移動します。</p>
        </div>
        <Button href="/hq" variant="secondary" className="shrink-0">アカウント管理へ戻る</Button>
      </header>

      {error ? (
        <div className="rounded-card bg-danger-bg p-4 text-sm text-danger" role="alert">
          <p>{error}</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            onClick={() => { setError(''); setLoading(true); setReloadKey((key) => key + 1) }}
          >
            再読み込み
          </Button>
        </div>
      ) : null}
      {!error && loading ? (
        <div className="flex min-h-64 items-center justify-center" role="status" aria-label="アカウントを読み込み中">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-hairline border-t-accent" />
        </div>
      ) : null}
      {!error && !loading && accounts.length === 0 ? (
        <section data-design="Empty" className="rounded-card border border-hairline bg-canvas px-6 py-16 text-center shadow-sm">
          <h2 className="text-xl font-bold text-ink">まだアカウントがありません</h2>
          <p className="mt-2 text-sm text-ink-secondary">最初のLINE公式アカウントを登録してください。</p>
          <Button href="/accounts/new" variant="primary" className="mt-6">＋LINEアカウントを新規登録</Button>
        </section>
      ) : null}
      {!error && !loading && accounts.length > 0 ? (
        <HqAccountList accounts={accounts} onSelect={openStorePage} selectLabel="このアカウントを選ぶ" />
      ) : null}
    </div>
  )
}
