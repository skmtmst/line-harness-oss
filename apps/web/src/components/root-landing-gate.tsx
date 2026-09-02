'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { decideRootLanding } from '@/lib/hq-navigation'

export default function RootLandingGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { accounts, selectedAccountId, setSelectedAccountId, loading } = useAccount()
  const decision = pathname === '/'
    ? decideRootLanding(loading, selectedAccountId, accounts.map((account) => account.id))
    : { action: 'show-dashboard' as const }

  useEffect(() => {
    if (decision.action === 'select-account') {
      setSelectedAccountId(decision.accountId)
    } else if (decision.action === 'go-hq') {
      router.replace('/hq')
    }
  }, [decision.action, decision.action === 'select-account' ? decision.accountId : null, router, setSelectedAccountId])

  if (decision.action !== 'show-dashboard') {
    return (
      <div className="flex min-h-64 items-center justify-center" role="status" aria-label="表示先を確認中">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-hairline border-t-accent" />
      </div>
    )
  }

  return <>{children}</>
}
