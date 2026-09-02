'use client'

import { usePathname } from 'next/navigation'
import Button from '@/components/shared/button'
import { useAccount } from '@/contexts/account-context'
import { decideStoreRoute } from '@/lib/store-route-guard'

export default function StoreSelectionGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { loading, selectedAccountId } = useAccount()
  const decision = decideStoreRoute(pathname, loading, selectedAccountId)

  if (decision === 'show') return <>{children}</>

  if (decision === 'wait') {
    return (
      <div className="flex min-h-64 items-center justify-center" role="status" aria-label="店舗を確認中">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-hairline border-t-accent" />
      </div>
    )
  }

  if (decision === 'block-unselected') {
    return (
      <section data-design="Empty" className="rounded-card border border-hairline bg-canvas px-6 py-16 text-center shadow-sm">
        <h1 className="text-xl font-bold text-ink">店舗が選ばれていません</h1>
        <p className="mt-2 text-sm text-ink-secondary">この画面は店舗ごとのデータを扱います。統括の店舗一覧から店舗を選んでください。</p>
        <Button href="/hq" variant="primary" className="mt-6">店舗を選ぶ</Button>
      </section>
    )
  }

  return <>{children}</>
}
