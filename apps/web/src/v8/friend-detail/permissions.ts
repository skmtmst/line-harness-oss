'use client'

/*
 * 友だち詳細で「変える操作」を出してよいか。今の画面と同じ境目：
 * - 担当・対応状況（PUT /api/chats/:id）… オーナー・管理者、または '/chats' 編集キー（N-035）
 * - 情報欄の保存（PUT /api/friends/:id/fields）… オーナー・管理者、または
 *   'attribute.personal_info.edit' を持つスタッフ（個人情報の項目だけ）（N-045）
 * - 項目を作る・シナリオに登録する・リッチメニューの変更 … オーナー・管理者だけ
 *
 * 役割はサーバ（api.staff.me）から読む。読めるまでは手元の保存値で判断する。
 * 閲覧のみ（どれもできない人）には押せないボタンを置かず隠す（2026-10-06 オーナー）。
 */
import { useState } from 'react'
import type { FriendField } from '@line-crm/shared'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { canManageRole, useStaffRole } from '@/lib/staff-role'

/** 手元に保存された項目別の鍵（auth-guard が /api/auth/session から保存したもの）。 */
function storedKeys(): string[] {
  try {
    const raw = window.localStorage.getItem('lh_staff_permissions')
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export type FriendDetailPermissions = {
  manage: boolean
  editSupport: boolean
  saveFields: boolean
  canEditField: (field: FriendField) => boolean
  viewOnly: boolean
}

export function useFriendDetailPermissions(): FriendDetailPermissions {
  const role = useStaffRole()
  const [local] = useState(() => (typeof window === 'undefined'
    ? { manage: false, chats: false, personal: false }
    : {
        manage: isOwnerOrAdmin(),
        // 役割の判定と分けて、鍵だけを読む（サーバが staff と言ったら、手元の役割の値で通さない）。
        chats: storedKeys().includes('/chats'),
        personal: storedKeys().includes('attribute.personal_info.edit'),
      }))
  const manage = role === null ? local.manage : canManageRole(role)
  // 鍵（項目別の権限）はスタッフだけが持つ。オーナー・管理者は全部できる。
  const staffKeys = role === null || role === 'staff'
  const editSupport = manage || (staffKeys && local.chats)
  const saveFields = manage || (staffKeys && local.personal)
  return {
    manage,
    editSupport,
    saveFields,
    canEditField: (field) => manage || (field.isPersonal && saveFields),
    viewOnly: !manage && !editSupport && !saveFields,
  }
}
