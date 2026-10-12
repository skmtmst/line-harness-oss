'use client'
import { Suspense } from 'react'
import AutomationRunsV8 from '@/v8/automations/runs'


export default function AutomationRunsPage() {
  return (
    <Suspense fallback={null}>
      <AutomationRunsV8 />
    </Suspense>
  )
}
