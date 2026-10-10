'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import TargetMissing from '@/components/shared/target-missing'
import ScenarioDetailV8 from '@/v8/scenario-detail/detail'

function ScenarioDetailPageContent() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id')
  const showStarted = searchParams.get('started') === '1'
  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="見るシナリオが指定されていません"
        description="一覧から、見たいシナリオを選び直してください。"
        backHref="/scenarios"
        backLabel="シナリオ一覧へ戻る"
      />
    )
  }
  return <ScenarioDetailV8 scenarioId={id} showStarted={showStarted} />
}

// useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
export default function ScenarioDetailPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <ScenarioDetailPageContent />
    </Suspense>
  )
}
