'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { useAccount, type AccountWithStats } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import HqAccountList from '@/components/hq/account-list'
import AccountEditModal from '@/components/accounts/account-edit-modal'
import NoteBar from '@/components/shared/note-bar'
import SummaryCard from '@/components/shared/summary-card'

export default function HqPage() {
  const router = useRouter()
  const { setSelectedAccountId, refreshAccounts } = useAccount()
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingAccount, setEditingAccount] = useState<AccountWithStats | null>(null)

  const load = useCallback(async () => {
    setError('')
    const accountResponse = await api.lineAccounts.list()
    if (!accountResponse.success) throw new Error(accountResponse.error)
    setAccounts(accountResponse.data as AccountWithStats[])
  }, [])

  useEffect(() => {
    let cancelled = false
    void load()
      .catch(() => {
        if (!cancelled) setError('統括のアカウント情報を読み込めませんでした。時間をおいてもう一度お試しください。')
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

  const totals = useMemo(() => accounts.reduce((sum, account) => ({
    friends: sum.friends + (account.stats?.friendCount ?? 0),
    messages: sum.messages + (account.stats?.messagesThisMonth ?? 0),
    warnings: sum.warnings + (account.connection?.status === 'warn' ? 1 : 0),
    active: sum.active + (account.isActive ? 1 : 0),
  }), { friends: 0, messages: 0, warnings: 0, active: 0 }), [accounts])
  const month = new Date().getMonth() + 1

  return (
    <div data-design-node="MjMCg">
      <div data-design="Actions" data-design-node="x5Tkb6" className="mb-4 flex justify-end">
        <Button href="/accounts/new" variant="primary" className="shrink-0">
          ＋ LINEアカウントを新規登録
        </Button>
      </div>

      {error ? <div className="rounded-card bg-danger-bg p-4 text-sm text-danger" role="alert">{error}</div> : null}

      {!error && loading ? (
        <div className="flex min-h-64 items-center justify-center" role="status" aria-label="アカウントを読み込み中">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-hairline border-t-accent" />
        </div>
      ) : null}

      {!error && !loading ? (
        <>
          <section data-design="KPIs" data-design-node="w7yY6" className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard variant="v6" title="アカウント" value={accounts.length} unit="件" detail={`有効 ${totals.active}・停止中 ${accounts.length - totals.active}`} />
            <SummaryCard variant="v6" title="友だち合計" value={totals.friends} unit="人" detail="全アカウントの合計" />
            <SummaryCard variant="v6" title="今月の配信" value={totals.messages} unit="通" detail={`${month}/1 から今日まで`} />
            <SummaryCard variant="v6" title="要確認" value={totals.warnings} unit="件" detail="接続に問題があるアカウント" valueTone="warning" />
          </section>
          <div data-design="Note" data-design-node="d61vBH" className="mb-4">
            <NoteBar>LINE公式アカウントごとに管理画面へ入れます。アイコンと名前はLINE公式アカウントの設定をそのまま表示します。</NoteBar>
          </div>
        </>
      ) : null}

      {!error && !loading && accounts.length === 0 ? (
        <section data-design="Empty" className="rounded-card border border-hairline bg-canvas px-6 py-16 text-center shadow-sm">
          <h2 className="text-xl font-bold text-ink">まだアカウントがありません</h2>
          <p className="mt-2 text-sm text-ink-secondary">最初のLINE公式アカウントを登録すると、ここからアカウントへログインできます。</p>
          <Button href="/accounts/new" variant="primary" className="mt-6">
            ＋ LINEアカウントを新規登録
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
