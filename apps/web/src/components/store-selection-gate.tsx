'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import PagePending from '@/components/templates/page-pending'
import { useAccount } from '@/contexts/account-context'
import { storeSelectionHref } from '@/lib/hq-navigation'
import { decideStoreRoute, isAccountIndependentRoute } from '@/lib/store-route-guard'
import { api } from '@/lib/api'

export default function StoreSelectionGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { loading, selectedAccountId, accounts, error, refreshing, refreshAccounts } = useAccount()
  const decision = decideStoreRoute(pathname, loading, selectedAccountId)
  const needsHandoverCheck = decision === 'show' && !isAccountIndependentRoute(pathname)
  // 「店舗を選ぶ」から戻る先（元の通知編集など）を持ち越す。
  // クエリは window からしか取れないのでマウント後に組み立てる（NEXT-07）。
  const [selectHref, setSelectHref] = useState('/hq')
  const [handoverGate, setHandoverGate] = useState<{ id: string; status: 'ready' | 'pending' | 'error' } | null>(null)
  const [handoverRetry, setHandoverRetry] = useState(0)
  useEffect(() => {
    setSelectHref(storeSelectionHref(`${window.location.pathname}${window.location.search}`))
  }, [pathname])

  useEffect(() => {
    if (!needsHandoverCheck || !selectedAccountId) return
    let active = true
    void api.lineAccounts.followerImportState(selectedAccountId).then((response) => {
      if (!active) return
      if (!response.success) throw new Error(response.error)
      const status = response.data.phase === 'importing_ids' || response.data.phase === 'hydrating_profiles' ? 'pending' : 'ready'
      setHandoverGate({ id: selectedAccountId, status })
      if (status === 'pending') router.replace(`/accounts/new/handover?accountId=${encodeURIComponent(selectedAccountId)}`)
    }).catch(() => {
      if (active) setHandoverGate({ id: selectedAccountId, status: 'error' })
    })
    return () => { active = false }
  }, [needsHandoverCheck, selectedAccountId, handoverRetry, router])

  if (decision === 'show') {
    if (!needsHandoverCheck) return <>{children}</>
    if (handoverGate?.id === selectedAccountId && handoverGate.status === 'ready') return <>{children}</>
    if (handoverGate?.id === selectedAccountId && handoverGate.status === 'error') return <PagePending stage="handover" failed errorTitle="友だちの引き継ぎ状態を確認できません" onRetry={() => setHandoverRetry((value) => value + 1)} />
    return <PagePending stage="handover" />
  }

  if (decision === 'wait') {
    return <PagePending stage="store" />
  }

  if (decision === 'block-unselected') {
    // 一覧の取得失敗は「店舗が選ばれていません」とは別の事故。
    // 失敗を伝えて読み直せるようにする（Issue #978）。
    if (error && accounts.length === 0) {
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
    return (
      <section data-design="Empty" className="rounded-card border border-hairline bg-canvas px-6 py-16 text-center shadow-card-surface">
        <h1 className="text-xl font-bold text-ink">LINE公式アカウントを選んでください</h1>
        <p className="mt-2 text-sm text-ink-secondary">この画面はLINE公式アカウントごとのデータを扱います。統括のアカウント一覧から選んでください。</p>
        <Button href={selectHref} variant="primary" className="mt-6">LINE公式アカウントを選ぶ</Button>
      </section>
    )
  }

  return <>{children}</>
}
