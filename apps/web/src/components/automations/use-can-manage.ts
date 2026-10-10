'use client'

import { useStaffRole } from '@/lib/staff-role'
import { readStaffIdentity } from '@/lib/staff-identity-state'

/**
 * 下書き・編集の表示切り替え1本化（#519 軽 / #942 N-351）。
 *
 * 役割と鍵は本人APIで確認した応答を使う。
 * 本当の可否はサーバ（`/automations` の権限キー）が決める。権限の条件を
 * 変えるときはここ1か所を直す。呼び側の名前は互換のため残す。
 */
export function useCanManage(): boolean | null {
  return canManageAutomationRole(useStaffRole(), readPermissionKeys())
}

function readPermissionKeys(): string[] {
  return readStaffIdentity()?.permissionKeys ?? []
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

/**
 * 実行記録の操作ボタン表示の目安（#1043 / V6 §9）。
 *
 * 本人APIで確認した応答を表示の目安にし、
 * 本当の可否はサーバが個別権限キーで決める。
 * - 再試行・取りやめ: `automation.run.retry`
 * - CSV書き出し: `automation.run.export`
 * owner/admin は常に `true`。見るだけの staff は `false` で、
 * 出せない操作のボタン自体を出さない。
 */
export function canOperateAutomationRun(
  role: string | null,
  permissionKeys: readonly string[] = [],
): boolean {
  if (role === 'owner' || role === 'admin') return true
  return role === 'staff' && permissionKeys.includes('automation.run.retry')
}

export function canExportAutomationRuns(
  role: string | null,
  permissionKeys: readonly string[] = [],
): boolean {
  if (role === 'owner' || role === 'admin') return true
  return role === 'staff' && permissionKeys.includes('automation.run.export')
}

export function useAutomationRunPermissions(): { canOperate: boolean; canExport: boolean } | null {
  const role = useStaffRole()
  const keys = readPermissionKeys()
  return { canOperate: canOperateAutomationRun(role, keys), canExport: canExportAutomationRuns(role, keys) }
}
