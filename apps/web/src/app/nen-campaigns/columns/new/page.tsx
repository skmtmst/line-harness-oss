'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import ColumnNewV8 from './column-new-v8'

export default function NewNenColumnPage() {
  return <Suspense fallback={<ListState kind="loading" />}><ColumnNewV8 /></Suspense>
}
