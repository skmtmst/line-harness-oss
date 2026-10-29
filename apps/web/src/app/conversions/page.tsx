'use client'

import { Suspense, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import ListState from '@/components/shared/list-state'

const AFFILIATE_TABS = new Set(['affiliates', 'offers', 'approvals', 'payment', 'points', 'report'])

/**
 * 成果地点の一覧は「成果とアフィリエイト」内のタブへ統合した。
 * 旧URLの検索条件とタブ指定を残して新しい入口へ移す。
 */
function LegacyConversionsRoute() {
  const params = useSearchParams()
  const router = useRouter()
  const target = useMemo(() => {
    const next = new URLSearchParams(params.toString())
    const tab = next.get('tab')
    next.set('tab', tab && AFFILIATE_TABS.has(tab) ? tab : 'points')
    return `/affiliates?${next.toString()}`
  }, [params])
  useEffect(() => { router.replace(target) }, [router, target])
  return <ListState kind="loading" title="成果とアフィリエイトへ移動しています" />
}

export default function ConversionsPage() {
  return (
    <Suspense fallback={<ListState kind="loading" title="成果とアフィリエイトへ移動しています" />}>
      <LegacyConversionsRoute />
    </Suspense>
  )
}
