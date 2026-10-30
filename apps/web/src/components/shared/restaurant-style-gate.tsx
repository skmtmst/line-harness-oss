'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { useAccountStyle } from '@/hooks/use-account-style'

/** 飲食店以外のアカウントでは、URLを直接開いても設定画面を表示しない。 */
export default function RestaurantStyleGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const { data, status, stale } = useAccountStyle(selectedAccountId)

  useEffect(() => {
    if (status === 'error' || (status === 'ready' && (stale || data?.style !== 'restaurant'))) {
      router.replace('/settings')
    }
  }, [data?.style, router, stale, status])

  return status === 'ready' && !stale && data?.style === 'restaurant' ? children : null
}
