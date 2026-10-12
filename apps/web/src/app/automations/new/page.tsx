'use client'
import { Suspense } from 'react'
import { NewAutomationV8 } from '@/v8/automations/create/create'

export default function NewAutomationPage() {
  return (
    <Suspense fallback={null}>
      <NewAutomationV8 chrome="create" />
    </Suspense>
  )
}
