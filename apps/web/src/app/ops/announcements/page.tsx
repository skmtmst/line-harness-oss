'use client'

import { Suspense } from 'react'
import OpsAnnouncementsV8 from '@/v8/ops/announcements'
import ListState from '@/components/shared/list-state'

export default function OpsAnnouncementsPage() {
  return (
    <Suspense fallback={<ListState permissionScope="hq" kind="loading" title="読み込んでいます" />}>
      <OpsAnnouncementsV8 />
    </Suspense>
  )
}
