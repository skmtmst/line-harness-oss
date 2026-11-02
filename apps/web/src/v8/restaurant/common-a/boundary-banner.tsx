'use client'

import { useEffect, useState } from 'react'
import Notice from '@/components/shared/notice'
import { loadAdminVersionDetail } from '@/lib/admin-version-cache'

/** 本番や環境が確認できない場合は、検証環境と断定しない。 */
export function BoundaryBanner(_props: { note?: string } = {}) {
  const [staging, setStaging] = useState(false)
  useEffect(() => {
    let active = true
    void loadAdminVersionDetail().then(detail => {
      if (active) setStaging(detail.deploy_env === 'staging')
    }).catch(() => { if (active) setStaging(false) })
    return () => { active = false }
  }, [])
  return staging ? <Notice tone="info">検証環境です。予約サイトへは送りません</Notice> : null
}
