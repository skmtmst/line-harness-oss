'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import SupportMarkEditor from '@/components/friend-fields/support-mark-editor'
import ListState from '@/components/shared/list-state'

function EditSupportMarkPageInner() {
  const id = useSearchParams().get('id')
  return id ? <SupportMarkEditor markId={id} /> : <ListState kind="empty" description="編集する対応マークが指定されていません。対応マーク一覧へ戻ってください。" />
}

export default function EditSupportMarkPage() {
  return <Suspense fallback={<ListState kind="loading" />}><EditSupportMarkPageInner /></Suspense>
}
