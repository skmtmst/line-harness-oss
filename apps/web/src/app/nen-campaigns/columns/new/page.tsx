'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import ColumnNew from '@/v8/nen-campaigns/column-new'

export default function NewNenColumnPage() {
  return <Suspense fallback={<ListState kind="loading" />}><ColumnNew /></Suspense>
}
