'use client'
import { useEffect, useState } from 'react'
import type { AccountStyle } from '@line-crm/shared'
import { styleApi } from '@/lib/api/helpers/styles'

export type StarterButton = { label: string; feature: string; actionType?: 'uri' | 'message'; actionData?: string }
type ResolvedPreview = { key: string; buttons: StarterButton[] }

/** 保存と同じ解決済みのボタンだけ。未設定の行き先を見本で補わない。 */
export function useStarterMenu(accountId: string | null, style: AccountStyle) {
  const [snapshot, setSnapshot] = useState<{ accountId: string; style: AccountStyle; buttons: StarterButton[] | null; error: unknown } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    setSnapshot(null)
    if (!accountId) return
    let active = true
    void styleApi.starterSet(accountId, style).then(res => {
      if (!res.success) throw new Error('見本を読み込めませんでした')
      // T01の追加応答。未提供のWorkerで名前だけを本物のボタンとして描かない。
      const preview = (res.data as typeof res.data & { preview?: ResolvedPreview[] }).preview
      if (!Array.isArray(preview)) throw new Error('見本の行き先を確認できませんでした')
      const buttons = preview.flatMap(menu => menu.buttons)
      if (active) setSnapshot({ accountId, style, buttons, error: null })
    }).catch(error => { if (active) setSnapshot({ accountId, style, buttons: null, error }) })
    return () => { active = false }
  }, [accountId, style, tick])
  const current = snapshot?.accountId === accountId && snapshot.style === style ? snapshot : null
  return { buttons: current?.buttons ?? [], loading: !current, error: current?.error ?? null, reload: () => setTick(n => n + 1) }
}
