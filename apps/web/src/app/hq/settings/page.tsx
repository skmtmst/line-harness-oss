'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { usePageTitle } from '@/components/shell/page-chrome'

/**
 * 旧「統括設定」。2026-09-12 に左下のアカウントメニュー → メンバー管理へ移した（★V6 36-1・36-5）。
 * 古いリンクやブックマークが壊れないように、ここは転送だけを残す。
 */
export default function HqSettingsPage() {
  usePageTitle('メンバー管理')
  const router = useRouter()
  useEffect(() => {
    router.replace('/hq/members?tab=tenant')
  }, [router])
  return null
}
