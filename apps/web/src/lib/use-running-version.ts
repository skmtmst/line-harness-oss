'use client'

import { useEffect, useState } from 'react'
import { loadAdminVersionDetail, type AdminVersionDetail } from './admin-version-cache'

/** サイドバーと同じ稼働版の観測値。配備履歴や公開済みの最新版では穴埋めしない。 */
export function useRunningVersion() {
  const [detail, setDetail] = useState<AdminVersionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    void loadAdminVersionDetail().then(
      value => { if (active) { setDetail(value.version ? value : null); setLoading(false) } },
      () => { if (active) { setDetail(null); setLoading(false) } },
    )
    return () => { active = false }
  }, [])
  return { detail, statusText: loading ? '確認中' : detail ? '稼働版を確認' : '確認できませんでした' }
}
