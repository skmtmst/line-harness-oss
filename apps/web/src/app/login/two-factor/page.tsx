'use client'
import { useEffect, useLayoutEffect, useState } from 'react'
import { isOpsTwoFactorReturn } from '@/lib/admin-session'
import AdminTwoFactorV8 from '@/v8/login/two-factor-admin'
import OpsTwoFactorV8 from '@/v8/login/two-factor-ops'



const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect


/*
 * ★V8の認証画面へ固定。運営と管理画面の戻り先は引き続き区別する。
 */
export default function TwoFactorLoginPage() {
  const [ops, setOps] = useState<boolean | null>(null)
  useIsoLayoutEffect(() => {
    let stored: string | null = null
    try { stored = sessionStorage.getItem('lh_2fa_next') } catch { /* 読めなければ URL だけで決める */ }
    setOps(isOpsTwoFactorReturn(window.location.search, window.location.hash, stored))
  }, [])
  if (ops === null) return null
  return ops ? <OpsTwoFactorV8 /> : <AdminTwoFactorV8 />
}
