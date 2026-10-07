'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import TargetMissing from '@/components/shared/target-missing'
import { useAdminTheme } from '@/lib/use-admin-theme'
import ScenarioDetailClient from './scenario-detail-client'
import ScenarioDetailV8 from '@/v8/scenario-detail/detail'

function ScenarioDetailPageContent() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id')
  const showStarted = searchParams.get('started') === '1'
  /*
   * ★V8 への切り替えはテーマで行う。data-theme="v8" のときだけ
   * src/v8/scenario-detail/detail.tsx（PMLkX / nMSiE / ARuZ4 / kz2B6、小窓 F1LK4e・OPGU2・Al4Ek）
   * を描き、それ以外は今までどおりの v7 を出す。
   */
  const theme = useAdminTheme()
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
  if (theme === 'v8') {
    return <ScenarioDetailV8 scenarioId={id} showStarted={showStarted} />
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
