'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import ScenarioResultsV8 from '@/v8/scenarios/results'

// V8 を直接描き、検索パラメータは Suspense の中で読む。
export default function ScenarioResultsPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <ScenarioResultsV8 />
    </Suspense>
  )
}
