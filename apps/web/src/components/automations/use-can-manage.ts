'use client'

import { useEffect, useState } from 'react'

/**
 * 下書き・編集の表示切り替え1本化（#519 軽 / #942 N-351）。
 *
 * `localStorage` の自己申告値は偽装できるため、表示の目安にしか使わない。
 * 本当の可否はサーバ（`/automations` の権限キー）が決める。権限の条件を
 * 変えるときはここ1か所を直す。呼び側の名前は互換のため残す。
 */
export function useCanManage(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  useEffect(() => {
    setAllowed(canManageAutomationRole(
      window.localStorage.getItem('lh_staff_role'),
      readPermissionKeys(),
    ))
  }, [])
  return allowed
}

function readPermissionKeys(): string[] {
  try {
    const raw = window.localStorage.getItem('lh_staff_permissions')
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/**
 * 一覧・下書きの操作可否だけを決める純粋関数（N-361 / #942 N-351）。
 *
 * owner/admin は常に `true`。staff は権限キー `/automations` を持つとき
 * `true`（サーバの `requireAutomationPermission` と同じ条件）。
 * キーの無い staff・不明・未設定は `false`。
 * フックから切り出してあるので、画面を描かずに単体で確かめられる。
 */
export function canManageAutomationRole(
  role: string | null,
  permissionKeys: readonly string[] = [],
): boolean {
  if (role === 'owner' || role === 'admin') return true
  return role === 'staff' && permissionKeys.includes('/automations')
}
