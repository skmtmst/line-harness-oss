import { useEffect, useLayoutEffect, useState } from 'react'
import type { MenuSection } from '@/lib/menu'
import { readStaffIdentity } from '@/lib/staff-identity-state'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

type Selection = Array<{ id: string; items: string[] }>
/** 本人・担当店舗・権限が一致する前回の項目だけを、設定を読み直す間に出す。 */
export function useRememberedSidebar(current: MenuSection[], available: MenuSection[], accountId: string | null, loading: boolean, ready: boolean) {
  const staff = readStaffIdentity()
  const key = staff?.id && accountId ? `musubo:sidebar:${JSON.stringify([staff.id, staff.tenantId, accountId, staff.accountScope, staff.scopedLineAccountIds, staff.policyVersion, staff.role, staff.permissionKeys, staff.permissionViewKeys, staff.readOnly, staff.roleBundle])}` : null
  const [saved, setSaved] = useState<{ key: string; selection: Selection } | null>(null)
  const selectionJson = JSON.stringify(current.map(section => ({ id: section.id, items: section.items.map(item => item.id) })))
  useIsoLayoutEffect(() => {
    if (!key) { setSaved(null); return }
    try {
      if (ready) {
        const selection: Selection = JSON.parse(selectionJson)
        window.sessionStorage.setItem(key, JSON.stringify(selection))
        setSaved({ key, selection })
      } else if (loading) {
        const raw = window.sessionStorage.getItem(key)
        const selection: unknown = raw ? JSON.parse(raw) : null
        if (Array.isArray(selection) && selection.every(row => row && typeof row.id === 'string' && Array.isArray(row.items) && row.items.every((id: unknown) => typeof id === 'string'))) setSaved({ key, selection })
      }
    } catch { /* 記憶を使えない端末では現在の項目を使う。 */ }
    // 項目が同じなら再保存しない。ルーターの別描画で更新を繰り返さない。
  }, [key, loading, ready, selectionJson])
  if (!loading || !key || saved?.key !== key) return current
  return saved.selection.flatMap(row => {
    const section = available.find(section => section.id === row.id)
    if (!section) return []
    const items = row.items.flatMap(id => section.items.find(item => item.id === id) ?? [])
    return items.length ? [{ ...section, items }] : []
  })
}
