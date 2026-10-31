'use client'

import { Fragment, useCallback, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'

const DEFAULT_QUERY_KEYS = ['id']

/** 処理を始めた画面がまだ有効かを照合する。対象変更や離脱後は通知・移動・表示更新を行わない。 */
export function usePageResourceTask() {
  const lifetime = useRef<object | null>(null)
  useLayoutEffect(() => {
    const active = {}
    lifetime.current = active
    return () => { lifetime.current = null }
  }, [])
  return useCallback(() => {
    const started = lifetime.current
    return () => started !== null && lifetime.current === started
  }, [])
}

/** 対象を替えた後に、前の対象の名前・入力・取得結果を出さない。 */
export default function PageResourceScope({ children, queryKeys = DEFAULT_QUERY_KEYS, enabled = true }: {
  children: ReactNode
  queryKeys?: readonly string[]
  enabled?: boolean
}) {
  const { selectedAccountId } = useAccount()
  const params = useSearchParams()
  const identity = enabled ? JSON.stringify([selectedAccountId, ...queryKeys.map(key => params.get(key))]) : 'embedded'
  return <Fragment key={identity}>{children}</Fragment>
}
