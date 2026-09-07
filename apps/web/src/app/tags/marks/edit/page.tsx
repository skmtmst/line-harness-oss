'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import SupportMarkEditor from '@/components/friend-fields/support-mark-editor'
import ListState from '@/components/shared/list-state'

function EditSupportMarkPageInner() {
  const id = useSearchParams().get('id')
  return <SupportMarkEditor markId={id ?? undefined} />
}

export default function EditSupportMarkPage() {
  return <Suspense fallback={<ListState kind="loading" />}><EditSupportMarkPageInner /></Suspense>
}
