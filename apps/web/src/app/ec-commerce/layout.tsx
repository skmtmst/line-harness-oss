'use client'

import { useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { useAccountStyle } from '@/hooks/use-account-style'
import ListState from '@/components/shared/list-state'

/** メニューを経由せずURLを開いた場合も、選択中のEC用途以外には画面を出さない。 */
export default function EcCommerceLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const profile = useAccountStyle(selectedAccountId)
  const isEc = profile.status === 'ready' && profile.data?.style === 'ec' && profile.data.styleSelected === true

  useEffect(() => {
    if (profile.status === 'ready' && !isEc) router.replace('/settings')
  }, [isEc, profile.status, router])

  if (!selectedAccountId || profile.status === 'loading' || profile.status === 'idle') return <ListState kind="loading" />
  if (profile.status === 'error') return <ListState kind="error" title="使い方を確認できませんでした" onRetry={profile.reload} />
  return isEc ? children : null
}
