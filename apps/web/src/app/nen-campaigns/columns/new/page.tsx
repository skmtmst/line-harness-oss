'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import { useAdminTheme } from '@/lib/use-admin-theme'
import ColumnNew from '@/v8/nen-campaigns/column-new'
import ColumnNewV8 from './column-new-v8'

/*
 * ★V8-B：data-theme="v8" のときだけ新しい「コラムを書く」（src/v8/nen-campaigns/column-new.tsx：yRDwW）。
 * それ以外は今の画面のまま。
 */
function NewNenColumnRoute() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <ColumnNew /> : <ColumnNewV8 />
}

export default function NewNenColumnPage() {
  return <Suspense fallback={<ListState kind="loading" />}><NewNenColumnRoute /></Suspense>
}
