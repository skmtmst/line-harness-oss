'use client'

import { useEffect, useState } from 'react'

/**
 * R511: 対応マークの作成・編集を画面で案内してよい役割か。
 *
 * サーバの口（POST・PATCH /api/support-marks）は `requireRole('owner', 'admin')`
 * で、staff はタグの権限キーを持っていても作れない・変えられない。
 * タグの作成と同じ約束。ここは表示の目安で、本当の可否はサーバが決める
 * （`localStorage` の自己申告値は偽装できるため）。
 *
 * 役割がまだ読めていない・保存されていないときは `null` を返し、
 * 呼び側は案内を出したままにする（表示の目安）。本当の可否はサーバが
 * 決め、403 が返ってきたら保存時に止める。
 */
export function canManageSupportMarkByRole(role: string | null): boolean | null {
  if (role === null || role === '') return null
  return role === 'owner' || role === 'admin'
}

export function useCanManageSupportMark(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  useEffect(() => {
    try {
      setAllowed(canManageSupportMarkByRole(window.localStorage.getItem('lh_staff_role')))
    } catch {
      setAllowed(null)
    }
  }, [])
  return allowed
}
