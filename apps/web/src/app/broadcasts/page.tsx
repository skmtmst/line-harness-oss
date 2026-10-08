'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import BroadcastListV8 from '@/v8/broadcasts/list'

// V8 を直接描き、検索パラメータは Suspense の中で読む。
export default function BroadcastsPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <BroadcastListV8 />
    </Suspense>
  )
}
