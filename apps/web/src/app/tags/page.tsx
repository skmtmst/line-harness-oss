'use client'

import { Suspense } from 'react'
import TagsPageV4 from '@/components/friend-fields/tags-page-v4'
import { useAccount } from '@/contexts/account-context'

/**
 * 友だち属性（4タブ）の入口。中身は `tags-page-v4.tsx` が正本。
 * ここは選んだアカウントを渡すだけにする。
 */
export default function TagsPage() {
  const { selectedAccountId } = useAccount()
  return (
    <Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}>
      <TagsPageV4 accountId={selectedAccountId} />
    </Suspense>
  )
}
