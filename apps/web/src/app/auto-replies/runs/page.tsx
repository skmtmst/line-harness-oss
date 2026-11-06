'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import AutoReplyRunsV8 from '@/v8/auto-replies/runs'

// V8 を直接描き、検索パラメータは Suspense の中で読む。
export default function AutoReplyRunsPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <AutoReplyRunsV8 />
    </Suspense>
  )
}
