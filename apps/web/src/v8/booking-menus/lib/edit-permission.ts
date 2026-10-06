import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { canEditFeature } from '@/lib/staff-capability'
import { canManageRole } from '@/lib/staff-role'

/** 担当者（staff）に渡された項目キー（auth-guard が保存した edit キー）。 */
function staffEditKeys(): string[] {
  try {
    const raw = window.localStorage.getItem('lh_staff_permissions')
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

/**
 * ログイン中の担当者の役割をサーバー（/api/staff/me）から読む。
 * 読めない・まだ来ないあいだは null（呼び出し側は手元の判定を使う）。
 */
function useServerRole(): string | null {
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const me = api.staff?.me
    if (typeof me !== 'function') return () => { active = false }
    Promise.resolve()
      .then(() => me())
      .then((response) => {
        if (active && response?.success && response.data?.role) setRole(response.data.role)
      })
      .catch(() => {})
    return () => { active = false }
  }, [])
  return role
}

/**
 * 予約設定の変更操作を出してよいか。
 *
 * 役割はサーバー（/api/staff/me）から読む。手元の保存値の役割は書き換えられるので、
 * サーバーの答えが来たらそちらを信じる：オーナー・管理者は変えられる、担当者は
 * 項目キー（例 `/booking/menus`・`booking.settings`）を持つときだけ変えられる。
 * 答えが来るまでは今までどおり手元の判定（canEditFeature）を使う。
 */
export function useBookingEdit(permission: string): boolean {
  const role = useServerRole()
  if (typeof window === 'undefined') return false
  if (role === null) return canEditFeature(permission)
  if (canManageRole(role)) return true
  return staffEditKeys().includes(permission)
}
