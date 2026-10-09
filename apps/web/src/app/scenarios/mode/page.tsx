'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import ScenarioModeV8 from '@/v8/scenarios/create'

// V8 を直接描き、検索パラメータは Suspense の中で読む。
export default function ScenarioModePage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <ScenarioModeV8 />
    </Suspense>
  )
}
