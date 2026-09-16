'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import SupportMarkEditor from '@/components/friend-fields/support-mark-editor'
import ListState from '@/components/shared/list-state'
import FeatureGate from '@/components/feature-gate'

function EditSupportMarkPageInner() {
  const id = useSearchParams().get('id')
  return <SupportMarkEditor markId={id ?? undefined} />
}

export default function EditSupportMarkPage() {
  return <FeatureGate feature="support_marks"><Suspense fallback={<ListState kind="loading" />}><EditSupportMarkPageInner /></Suspense></FeatureGate>
}
