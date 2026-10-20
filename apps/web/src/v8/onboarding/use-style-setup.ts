'use client'

import { useCallback, useEffect, useState } from 'react'
import { styleApi } from '@/lib/api/helpers/styles'
import type { StarterItemState, StyleState, StyleWarning } from './model'
import { canManageRole } from '@/lib/staff-role'

export type StyleSetupData = {
  state: StyleState
  warnings: StyleWarning[]
  items: StarterItemState[]
}

/** 取得不能と未設定を分ける。アカウント切替直後も前の店の状態を返さない。 */
export function useStyleSetup(accountId: string | null, role: string | null) {
  const [snapshot, setSnapshot] = useState<{ accountId: string; data: StyleSetupData | null; error: unknown; status: 'ready' | 'error' } | null>(null)
  const [tick, setTick] = useState(0)
  const enabled = canManageRole(role)
  useEffect(() => {
    setSnapshot(null)
    if (!accountId || !enabled) return
    let cancelled = false
    void Promise.all([styleApi.get(accountId), styleApi.warnings(accountId), styleApi.starterItems(accountId)])
      .then(([state, warnings, items]) => {
        if (!state.success || !warnings.success || !items.success) throw new Error('初期設定の状態を読み込めませんでした')
        if (!cancelled) setSnapshot({ accountId, data: { state: state.data, warnings: warnings.data.items ?? [], items: items.data.items ?? [] }, error: null, status: 'ready' })
      })
      .catch((error: unknown) => { if (!cancelled) setSnapshot({ accountId, data: null, error, status: 'error' }) })
    return () => { cancelled = true }
  }, [accountId, enabled, tick])
  const reload = useCallback(() => setTick((value) => value + 1), [])
  const current = enabled && snapshot?.accountId === accountId ? snapshot : null
  return { data: current?.data ?? null, error: current?.error ?? null, status: !enabled || !accountId ? 'idle' as const : current?.status ?? 'loading' as const, reload }
}
