'use client'

import { useEffect, useState } from 'react'

/**
 * 下書き・編集の表示切り替え1本化（#519 軽）。
 *
 * `localStorage` の自己申告値は偽装できるため、表示の目安にしか使わない。
 * 本当の可否はサーバ（owner/admin 制約）が決める。権限の条件を変えるときは
 * ここ1か所を直す。呼び側の名前は互換のため残す。
 */
export function useCanManage(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  useEffect(() => {
    setAllowed(canManageAutomationRole(window.localStorage.getItem('lh_staff_role')))
  }, [])
  return allowed
}

/**
 * 役割の自己申告値から一覧の操作可否だけを決める純粋関数（N-361）。
 *
 * owner/admin だけが `true`。staff・不明・未設定は `false`。
 * 要件 §9 の既定 bundle（有効化・停止・保管は owner/admin のみ）に合わせる。
 * フックから切り出してあるので、画面を描かずに単体で確かめられる。
 */
export function canManageAutomationRole(role: string | null): boolean {
  return role === 'owner' || role === 'admin'
}
