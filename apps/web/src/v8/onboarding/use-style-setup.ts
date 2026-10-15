'use client'

import { useCallback, useEffect, useState } from 'react'
import { styleApi } from '@/lib/api-styles'
import type { StarterItemState, StyleState, StyleWarning } from './model'
import { canManageRole } from '@/lib/staff-role'

export type StyleSetupData = {
  state: StyleState
  warnings: StyleWarning[]
  items: StarterItemState[]
}

/**
 * ダッシュボードの「はじめにやること」と警告の帯の元（スタイル・答え・警告・入った物の状態）。
 * オーナー・管理者だけ読む。1つでも読めないときは null（はじめにやることは今までのカードのまま、
 * 警告の帯も出さない。分からない物を「未設定」と言って急かさない）。
 */
export function useStyleSetup(accountId: string | null, role: string | null) {
  const [data, setData] = useState<StyleSetupData | null>(null)
  const [tick, setTick] = useState(0)
  const enabled = canManageRole(role)
  useEffect(() => {
    setData(null)
    if (!accountId || !enabled) return
    let cancelled = false
    void Promise.all([styleApi.get(accountId), styleApi.warnings(accountId), styleApi.starterItems(accountId)])
      .then(([state, warnings, items]) => {
        if (cancelled || !state.success || !warnings.success || !items.success) return
        setData({ state: state.data, warnings: warnings.data.items ?? [], items: items.data.items ?? [] })
      })
      .catch(() => { /* 口がまだ無い・読めない：出さない */ })
    return () => { cancelled = true }
  }, [accountId, enabled, tick])
  const reload = useCallback(() => setTick((value) => value + 1), [])
  return { data, reload }
}
