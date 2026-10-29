'use client'

import { Suspense } from 'react'
import OpsAnnouncementEditV8 from '@/v8/ops/announcement-edit'
import ListState from '@/components/shared/list-state'

export default function OpsAnnouncementNewPage() {
  return (
    <Suspense fallback={<ListState permissionScope="hq" kind="loading" title="読み込んでいます" />}>
      <OpsAnnouncementEditV8 />
    </Suspense>
  )
}
