'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ListState from '@/components/shared/list-state'

// 公開の確認は作る画面の手順4へまとめ、既存の URL も受け付ける。
function AutoReplyPublishEntry() {
  const router = useRouter()
  const params = useSearchParams()
  useEffect(() => {
    const query = new URLSearchParams()
    const id = params.get('id')
    if (id) query.set('id', id)
    query.set('step', 'priority')
    router.replace(`/auto-replies/edit?${query.toString()}`)
  }, [router, params])
  return <ListState kind="loading" />
}

export default function AutoReplyPublishPage() {
  return <Suspense fallback={<ListState kind="loading" />}><AutoReplyPublishEntry /></Suspense>
}
