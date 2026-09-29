'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { usePageTitle } from '@/components/shell/page-chrome'

/** 旧「統括設定」。アカウントメニューのメンバー管理へ転送する。 */
export default function HqSettingsPage() {
  usePageTitle('メンバー管理')
  const router = useRouter()
  useEffect(() => {
    router.replace('/hq/members?tab=tenant')
  }, [router])
  return null
}
