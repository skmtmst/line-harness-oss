'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import FriendAddRunDetailV8 from '@/v8/friend-add-runs/detail'

// V8 を直接描き、検索パラメータは Suspense の中で読む。
export default function FriendAddRunDetailPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddRunDetailV8 />
    </Suspense>
  )
}
