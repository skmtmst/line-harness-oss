'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import { restaurantTestApi } from '@/lib/restaurant-test-api'

export default function StoreContextBanner() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [store, setStore] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setStore(null)
      return
    }
    try {
      const response = await restaurantTestApi.storeContext(selectedAccountId)
      setStore(response.data.selectedStore)
    } catch {
      setStore(null)
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  const returnToHeadquarters = async () => {
    if (!selectedAccountId || busy) return
    setBusy(true)
    try {
      await restaurantTestApi.clearStoreSelection(selectedAccountId)
      setStore(null)
      router.push('/hq')
    } finally {
      setBusy(false)
    }
  }

  if (!store) return null
  return <div className="sticky top-0 z-20 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-accent bg-accent-soft px-4 py-3 shadow-sm">
    <p className="text-sm text-ink"><strong>{store.name}</strong> を表示しています</p>
    <button type="button" disabled={busy} onClick={() => void returnToHeadquarters()} className="rounded-control border border-accent bg-canvas px-4 py-2 text-xs font-semibold text-success disabled:opacity-50">{busy ? '戻っています…' : '統括に戻る'}</button>
  </div>
}
