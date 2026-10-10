'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import AutoRepliesListV8 from '@/v8/auto-replies/list'

// V8 を直接描き、検索パラメータは Suspense の中で読む。
export default function AutoRepliesPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <AutoRepliesListV8 />
    </Suspense>
  )
}
