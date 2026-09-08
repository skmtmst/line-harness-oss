'use client'

import { Suspense } from 'react'
import NewTagPageV4 from '@/components/friend-fields/new-tag-page-v4'

export default function NewTagPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-ink-faint">読み込み中…</p>}>
      <NewTagPageV4 />
    </Suspense>
  )
}
