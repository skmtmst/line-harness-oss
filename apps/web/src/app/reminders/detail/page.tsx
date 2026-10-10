'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import ReminderDetailV8Page from '@/v8/reminders/detail'

// V8 を直接描き、検索パラメータは Suspense の中で読む。
export default function ReminderRunsPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <ReminderDetailV8Page />
    </Suspense>
  )
}
