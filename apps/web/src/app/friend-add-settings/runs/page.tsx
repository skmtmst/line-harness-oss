'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import FriendAddRunsV8 from '@/v8/friend-add-runs/runs'

// V8 を直接描き、検索パラメータは Suspense の中で読む。
export default function FriendAddRunsPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddRunsV8 />
    </Suspense>
  )
}
