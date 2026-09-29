'use client'

import { Suspense } from 'react'
import EditTagPageV4 from '@/components/friend-fields/edit-tag-page-v4'

export default function EditTagPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}>
      <EditTagPageV4 />
    </Suspense>
  )
}
