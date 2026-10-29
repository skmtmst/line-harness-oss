'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { invalidateApiReads } from '@/lib/api/transport/read-cache'

const TENANT_NAME_UPDATED_EVENT = 'lh:tenant-name-updated'

/** 統括の情報で保存した名前を、表示中のサイドバーへすぐ反映する。 */
export function publishTenantName(name: string): void {
  invalidateApiReads('/api/tenants/me')
  window.dispatchEvent(new CustomEvent(TENANT_NAME_UPDATED_EVENT, { detail: name }))
}

/** LINE アカウント名ではなく、ログイン中のスタッフが所属する統括名を読む。 */
export function useTenantName(): string {
  const [name, setName] = useState('統括')

  useEffect(() => {
    let cancelled = false
    let updatedAfterLoad = false
    const onUpdated = (event: Event) => {
      updatedAfterLoad = true
      setName((event as CustomEvent<string>).detail)
    }
    window.addEventListener(TENANT_NAME_UPDATED_EVENT, onUpdated)
    void api.tenants.me().then((response) => {
      if (!cancelled && !updatedAfterLoad && response.success && response.data.name) {
        setName(response.data.name)
      }
    }).catch(() => {
      // アカウント名へフォールバックすると別の統括名に見えるため、既定の「統括」を保つ。
    })
    return () => {
      cancelled = true
      window.removeEventListener(TENANT_NAME_UPDATED_EVENT, onUpdated)
    }
  }, [])

  return name
}
