'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import FriendAddPublishV8 from '@/v8/friend-add-publish/publish'

// V8 を直接描き、検索パラメータは Suspense の中で読む。
export default function FriendAddPublishPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddPublishV8 />
    </Suspense>
  )
}
