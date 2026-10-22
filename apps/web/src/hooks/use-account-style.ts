'use client'

import { useCallback, useEffect, useState } from 'react'
import { ACCOUNT_STYLES } from '@line-crm/shared'
import { invalidateApiReads } from '@/lib/api/transport/read-cache'
import type { styleApi } from '@/lib/api/helpers/styles'

export const ACCOUNT_STYLE_UPDATED = 'musubo:account-style-updated'
export function accountStyleUpdated(accountId: string) {
  invalidateApiReads('/api/dashboard/style', accountId)
  window.dispatchEvent(new CustomEvent(ACCOUNT_STYLE_UPDATED, { detail: { accountId } }))
}

type Data = Awaited<ReturnType<typeof styleApi.get>>['data']
function load(accountId: string): Promise<Data> {
  return import('@/lib/api/helpers/styles').then(module => module.styleApi.get(accountId)).then(res => {
    if (!res.success || !ACCOUNT_STYLES.includes(res.data?.style)) throw new Error('使い方のスタイルを読み込めませんでした')
    return res.data
  })
}

/** サーバーで所属を確かめた業種。切替の最初の描画から前の店を返さない。 */
export function useAccountStyle(accountId: string | null | undefined) {
  const [snapshot, setSnapshot] = useState<{ accountId: string; data: Data | null; error: unknown } | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => { if (accountId) accountStyleUpdated(accountId) }, [accountId])
  useEffect(() => {
    setSnapshot(null)
    if (!accountId) return
    let active = true
    void load(accountId).then(data => {
      if (active) setSnapshot({ accountId, data, error: null })
    }, error => { if (active) setSnapshot({ accountId, data: null, error }) })
    return () => { active = false }
  }, [accountId, tick])
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ accountId: string }>).detail?.accountId === accountId) setTick(n => n + 1)
    }
    window.addEventListener(ACCOUNT_STYLE_UPDATED, changed)
    return () => window.removeEventListener(ACCOUNT_STYLE_UPDATED, changed)
  }, [accountId])
  const current = snapshot?.accountId === accountId ? snapshot : null
  return { data: current?.data ?? null, error: current?.error ?? null, reload,
    status: !accountId ? 'idle' as const : !current ? 'loading' as const : current.error ? 'error' as const : 'ready' as const }
}
