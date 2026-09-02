'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import ScenarioDetailClient from './scenario-detail-client'

function ScenarioDetailPageContent() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id')
  const showStarted = searchParams.get('started') === '1'
  if (!id) {
    return (
      <div className="p-8 text-center text-sm text-ink-faint">
        シナリオ ID が指定されていません
      </div>
    )
  }
  return <ScenarioDetailClient scenarioId={id} showStarted={showStarted} />
}

// useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
export default function ScenarioDetailPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <ScenarioDetailPageContent />
    </Suspense>
  )
}
