'use client'

import { Suspense } from 'react'
import NewTagPageV4 from '@/components/friend-fields/new-tag-page-v4'
import NewTagPageV8 from '../new-tag-page-v8'
import { useAdminTheme } from '@/lib/use-admin-theme'

/** v8 テーマのときだけ新しい作る画面（new-tag-page-v8）。v7 は無変更。 */
export default function NewTagPage() {
  const theme = useAdminTheme()
  return (
    <Suspense fallback={<p className="p-6 text-sm text-ink-faint">読み込み中…</p>}>
      {theme === 'v8' ? <NewTagPageV8 /> : <NewTagPageV4 />}
    </Suspense>
  )
}
