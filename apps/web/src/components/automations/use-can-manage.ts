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
    const role = window.localStorage.getItem('lh_staff_role')
    setAllowed(role === 'owner' || role === 'admin')
  }, [])
  return allowed
}
