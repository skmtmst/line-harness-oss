'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { RestaurantSnapshot } from '@/lib/restaurant-test-api'
import type { RestaurantTableDefinition } from './table-definition'

type Period = { accountId: string | null }
type Request = { period: Period; accountId: string | null }
type Receipt = RestaurantTableDefinition & { request: Request }

/** データの既存反映は変えず、現在の表示期間の最新取得だけを説明の根拠にする。 */
export function useTableDefinition(accountId: string | null, snapshot: RestaurantSnapshot | null) {
  const period = useRef<Period>({ accountId })
  const latest = useRef<Request | null>(null)
  const [receipt, setReceipt] = useState<Receipt>()
  useLayoutEffect(() => {
    if (period.current.accountId !== accountId) period.current = { accountId }
  }, [accountId])
  const begin = useCallback((sourceAccountId: string | null) => {
    const request = { period: period.current, accountId: sourceAccountId }
    latest.current = request
    setReceipt(undefined)
    return request
  }, [])
  const accept = useCallback((request: Request, data: RestaurantSnapshot) => {
    if (latest.current !== request || request.period !== period.current || !request.accountId || request.accountId !== period.current.accountId) return
    setReceipt({ accountId: request.accountId, snapshot: data, request })
  }, [])
  const tableDefinition = receipt && receipt.request.period === period.current && period.current.accountId === accountId && receipt.accountId === accountId && receipt.snapshot === snapshot
    ? receipt : undefined
  return { begin, accept, tableDefinition }
}
