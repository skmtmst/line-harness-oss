'use client'

import { useEffect, useState } from 'react'
import { restaurantDeliveryApi, type DeliveryConnectionStatus } from '@/lib/restaurant-delivery-api'

/** 接続の札は設定画面と同じ保存済みの接続を読む。受注の設定を接続完了とみなさない。 */
export function useUberConnection(accountId: string | null): DeliveryConnectionStatus | null {
  const [connection, setConnection] = useState<{ accountId: string; status: DeliveryConnectionStatus } | null>(null)
  useEffect(() => {
    let current = true
    if (!accountId) return
    void restaurantDeliveryApi.ubereatsConnection(accountId).then(({ connection }) => {
      if (!current) return
      const unknown = connection.lastError === 'pos_activation_started' || connection.lastError === 'pos_activation_unknown'
      const status: DeliveryConnectionStatus = unknown || connection.status === 'expired' || connection.status === 'no_permission'
        ? 'error'
        : connection.status === 'connected' ? 'connected' : 'disconnected'
      setConnection({ accountId, status })
    }).catch(() => {
      if (current) setConnection(null)
    })
    return () => { current = false }
  }, [accountId])
  return connection?.accountId === accountId ? connection.status : null
}
