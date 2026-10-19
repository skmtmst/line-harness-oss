'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { loadFeatureSettings } from '@/lib/feature-settings-cache'
import { FEATURE_SETTINGS_UPDATED_EVENT } from '@/lib/feature-settings'
import { buildStepsFromApi, featureSetEntry, insertFeatureSet, type StepResult } from '@/v8/settings/public/steps/index'

/** ダッシュボードと設定の完了条件の正本は同じ V8 API。訪問・招待人数では判定しない。 */
export async function loadFirstRunSteps(accountId: string | null): Promise<StepResult[]> {
  const res = await api.gettingStarted.get(accountId ?? undefined, 'v8')
  if (!res.success) throw new Error(res.error)
  const steps = buildStepsFromApi(res.data.steps)
  if (res.data.steps.some((step) => step.key === 'featureSet')) return steps
  // 更新途中の Worker でも未取得は未確認。保存済みの機能設定だけで補う。
  let entry = null
  if (accountId) {
    const features = await loadFeatureSettings(accountId)
    if (!features.success) throw new Error(features.error)
    entry = featureSetEntry({ forbidden: false, version: features.data.version ?? 0 })
  }
  return insertFeatureSet(steps, entry)
}

export function useFirstRun(accountId: string | null, enabled = true) {
  const [snapshot, setSnapshot] = useState<{ accountId: string | null; steps: StepResult[]; status: 'ready'; error: null } | { accountId: string | null; status: 'error'; error: unknown } | null>(null)
  const [tick, setTick] = useState(0)
  const generation = useRef(0)
  const reload = useCallback(() => { generation.current += 1; setSnapshot(null); setTick((n) => n + 1) }, [])
  useEffect(() => {
    const at = ++generation.current
    setSnapshot(null)
    if (!enabled) return
    void loadFirstRunSteps(accountId).then((steps) => {
      if (generation.current === at) setSnapshot({ accountId, steps, status: 'ready', error: null })
    }).catch((error: unknown) => {
      if (generation.current === at) setSnapshot({ accountId, status: 'error', error })
    })
    return () => { generation.current += 1 }
  }, [accountId, enabled, tick])
  useEffect(() => {
    window.addEventListener(FEATURE_SETTINGS_UPDATED_EVENT, reload)
    return () => window.removeEventListener(FEATURE_SETTINGS_UPDATED_EVENT, reload)
  }, [reload])
  const current = enabled && snapshot?.accountId === accountId ? snapshot : null
  return { steps: current?.status === 'ready' ? current.steps : [], status: current?.status ?? 'loading' as const, error: current?.error ?? null, reload }
}
