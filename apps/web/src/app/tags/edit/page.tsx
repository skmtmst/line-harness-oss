'use client'

import { Suspense } from 'react'
import EditTagPageV4 from '@/components/friend-fields/edit-tag-page-v4'
import EditTagPageV8 from '../edit-tag-page-v8'
import { useAdminTheme } from '@/lib/use-admin-theme'

/** v8 テーマのときだけ新しい編集画面（edit-tag-page-v8）。v7 は無変更。 */
export default function EditTagPage() {
  const theme = useAdminTheme()
  return (
    <Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}>
      {theme === 'v8' ? <EditTagPageV8 /> : <EditTagPageV4 />}
    </Suspense>
  )
}
