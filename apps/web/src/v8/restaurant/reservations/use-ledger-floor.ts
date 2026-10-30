import { useEffect, useState } from 'react'
import type { RestaurantFloor } from '@line-crm/shared'
import { reservationBoardApi } from '@/lib/api/helpers/reservation-board'

/** 読込失敗を未設定と扱わず、店舗を変えた後の古い応答も捨てる。 */
export function useLedgerFloor(accountId: string | null | undefined, storeId: string) {
  const [floor, setFloor] = useState<RestaurantFloor>()
  const [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    setFloor(undefined)
    setError(null)
    if (accountId && storeId) void reservationBoardApi.floors(accountId, storeId)
      .then(result => {
        if (!Array.isArray(result.data)) throw new Error('座席表を読み込めませんでした')
        if (current) setFloor(result.data[0])
      })
      .catch(caught => { if (current) setError(caught) })
    return () => { current = false }
  }, [accountId, storeId, retry])
  return { floor, error, reload: () => setRetry(value => value + 1) }
}
