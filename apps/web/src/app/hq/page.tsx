'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { useAccount, type AccountWithStats } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import HqAccountList from '@/components/hq/account-list'
import AccountEditModal from '@/components/accounts/account-edit-modal'

export default function HqPage() {
  const router = useRouter()
  const { setSelectedAccountId, refreshAccounts } = useAccount()
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [tenantName, setTenantName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingAccount, setEditingAccount] = useState<AccountWithStats | null>(null)

  const load = useCallback(async () => {
    setError('')
    const [accountResponse, tenantResponse] = await Promise.all([
      api.lineAccounts.list(),
      api.tenants.me(),
    ])
    if (!accountResponse.success) throw new Error(accountResponse.error)
    if (!tenantResponse.success) throw new Error(tenantResponse.error)
    setAccounts(accountResponse.data as AccountWithStats[])
    setTenantName(tenantResponse.data.name)
  }, [])

  useEffect(() => {
    let cancelled = false
    void load()
      .catch(() => {
        if (!cancelled) setError('統括の店舗情報を読み込めませんでした。時間をおいてもう一度お試しください。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [load])

  const reloadAfterSave = async () => {
    await Promise.all([load(), refreshAccounts()])
  }

  const login = (accountId: string) => {
    setSelectedAccountId(accountId)
    router.push('/')
  }

  return (
    <div>
      <header data-design="Head" className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-accent">統括コンソール</p>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-ink" title={tenantName || '統括'}>
            {tenantName || (loading ? '統括を読み込み中…' : '統括')}
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">LINE公式アカウントごとに店舗の管理画面へ移動できます。</p>
        </div>
        <Button href="/stores/new" variant="primary" className="shrink-0">
          ＋店舗の新規アカウント登録
        </Button>
      </header>

      {error ? <div className="rounded-card bg-danger-bg p-4 text-sm text-danger" role="alert">{error}</div> : null}

      {!error && loading ? (
        <div className="flex min-h-64 items-center justify-center" role="status" aria-label="店舗を読み込み中">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-hairline border-t-accent" />
        </div>
      ) : null}

      {!error && !loading && accounts.length === 0 ? (
        <section data-design="Empty" className="rounded-card border border-hairline bg-canvas px-6 py-16 text-center shadow-sm">
          <h2 className="text-xl font-bold text-ink">まだ店舗がありません</h2>
          <p className="mt-2 text-sm text-ink-secondary">最初のLINE公式アカウントを登録すると、ここから店舗へログインできます。</p>
          <Button href="/stores/new" variant="primary" className="mt-6">
            ＋店舗の新規アカウント登録
          </Button>
        </section>
      ) : null}

      {!error && !loading && accounts.length > 0 ? (
        <HqAccountList accounts={accounts} onSelect={login} onSettings={setEditingAccount} />
      ) : null}

      {editingAccount ? (
        <AccountEditModal
          accountId={editingAccount.id}
          initialName={editingAccount.name}
          initialChannelId={editingAccount.channelId}
          initialLoginChannelId={editingAccount.loginChannelId ?? null}
          initialLiffId={editingAccount.liffId ?? null}
          initialOgSiteName={editingAccount.ogSiteName ?? null}
          initialOgDefaultDescription={editingAccount.ogDefaultDescription ?? null}
          initialOgDefaultImageUrl={editingAccount.ogDefaultImageUrl ?? null}
          initialFriendCapacity={editingAccount.friendCapacity ?? null}
          initialCapacityWarnAt={editingAccount.capacityWarnAt ?? null}
          initialIconUrl={editingAccount.iconUrl ?? null}
          onClose={() => setEditingAccount(null)}
          onSaved={() => { void reloadAfterSave() }}
        />
      ) : null}
    </div>
  )
}
