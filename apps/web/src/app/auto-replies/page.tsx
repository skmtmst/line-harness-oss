'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import AutoRepliesEntry from '@/v8/ai-reply/auto-replies-entry'

// V8 を直接描き、検索パラメータは Suspense の中で読む（?tab= で キーワード・Q&A・AI が答えた記録）。
export default function AutoRepliesPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <AutoRepliesEntry />
    </Suspense>
  )
}
