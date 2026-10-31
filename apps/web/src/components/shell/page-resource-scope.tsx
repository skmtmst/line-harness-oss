'use client'

import { Fragment, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'

const DEFAULT_QUERY_KEYS = ['id']

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
