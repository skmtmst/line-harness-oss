'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import NewReminderV8 from './new-v8'

// V8 を直接描き、検索パラメータは Suspense の中で読む。
export default function NewReminderPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <NewReminderV8 />
    </Suspense>
  )
}
