'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import ScenarioCreateV8 from '@/v8/scenarios/create'

// V8 を直接描き、検索パラメータは Suspense の中で読む。
export default function ScenariosNewPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <ScenarioCreateV8 />
    </Suspense>
  )
}
