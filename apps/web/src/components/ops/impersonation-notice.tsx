'use client'

import { useEffect, useState } from 'react'
import { adminSessionHeaders } from '@/lib/admin-session'
import type { OpsImpersonation } from '@/lib/api'
import ImpersonationBar from './impersonation-bar'

/**
 * 統括・店舗の画面の上に出す代理ログイン帯。
 * /api/auth/session が impersonation を返すときだけ描く。
 * 運営マスター以外にはいつも何も出ない。
 */
export default function ImpersonationNotice() {
  const [state, setState] = useState<OpsImpersonation | null>(null)

  useEffect(() => {
    let cancelled = false
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    fetch(`${apiUrl}/api/auth/session`, { credentials: 'include', headers: adminSessionHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { data?: { impersonation?: OpsImpersonation | null } } | null) => {
        if (cancelled) return
        const imp = body?.data?.impersonation ?? null
        if (!imp) { setState(null); return }
        // 契約先の名前は /api/tenants/me が今の差し替え先を返す。
        fetch(`${apiUrl}/api/tenants/me`, { credentials: 'include', headers: adminSessionHeaders() })
          .then((res) => (res.ok ? res.json() : null))
          .then((tenant: { data?: { name?: string } } | null) => {
            if (!cancelled) setState({ ...imp, tenantName: tenant?.data?.name ?? null })
          })
          .catch(() => { if (!cancelled) setState(imp) })
      })
      .catch(() => { if (!cancelled) setState(null) })
    return () => { cancelled = true }
  }, [])

  if (!state) return null
  return <ImpersonationBar initial={state} onChange={(next) => { if (!next) setState(null) }} />
}
