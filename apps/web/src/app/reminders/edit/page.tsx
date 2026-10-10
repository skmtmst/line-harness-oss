'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import TargetMissing from '@/components/shared/target-missing'
import ListState from '@/components/shared/list-state'
import ReminderEditV8 from '@/v8/reminders/edit'

function ReminderEditInner() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  if (!id) return <TargetMissing kind="unspecified" title="編集するリマインダが指定されていません" description="一覧から編集するリマインダを選び直してください。" backHref="/reminders" backLabel="リマインダ一覧へ戻る" />
  return <ReminderEditV8 reminderId={id} stage={params.get('stage')} />
}

export default function ReminderEditPage() {
  return <Suspense fallback={<ListState kind="loading" />}><ReminderEditInner /></Suspense>
}
