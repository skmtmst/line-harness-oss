'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import ScenarioFirstStepV8 from '@/v8/scenario-first-step/first-step'

// V8 を直接描き、検索パラメータは Suspense の中で読む。
export default function FirstStepPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <ScenarioFirstStepV8 />
    </Suspense>
  )
}
