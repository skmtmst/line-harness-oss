'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import ListState from '@/components/shared/list-state'
import { decideRootLanding } from '@/lib/hq-navigation'

export default function RootLandingGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { accounts, selectedAccountId, setSelectedAccountId, loading, error, refreshing, refreshAccounts } = useAccount()
  // 一覧の取得に失敗したのに店舗数0として扱うと、統括へ飛ばされて
  // 「アカウントが1件も無い」ように見える（Issue #978）。
  const loadFailed = pathname === '/' && Boolean(error) && !loading && accounts.length === 0
  const decision = pathname === '/' && !loadFailed
    ? decideRootLanding(loading, selectedAccountId, accounts.map((account) => account.id))
    : { action: 'show-dashboard' as const }
  const decisionAccountId = decision.action === 'select-account' ? decision.accountId : null

  useEffect(() => {
    if (decision.action === 'select-account' && decisionAccountId) {
      setSelectedAccountId(decisionAccountId)
    } else if (decision.action === 'go-hq') {
      router.replace('/hq')
    }
  }, [decision.action, decisionAccountId, router, setSelectedAccountId])

  if (loadFailed) {
    return (
      <ListState
        kind="error"
        title="アカウント一覧を読み込めませんでした"
        description="通信状況を確認して、もう一度お試しください。"
        onRetry={() => { void refreshAccounts() }}
        retrying={refreshing}
      />
    )
  }

  if (decision.action !== 'show-dashboard') {
    return (
      <div className="flex min-h-64 items-center justify-center" role="status" aria-label="表示先を確認中">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-hairline border-t-accent" />
      </div>
    )
  }

  return <>{children}</>
}
