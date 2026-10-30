'use client'

import { useEffect } from 'react'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import ListState from '@/components/shared/list-state'

/**
 * B21：機能設定は /settings に統合した。古い住所（ブックマークなど）を
 * 開いた人が 404 にならず今の入口に着くよう送る。
 */
export default function LegacySettingsFeaturesPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/settings') }, [router])
  return <ListState kind="loading" title="機能設定へ移動しています" />
}
