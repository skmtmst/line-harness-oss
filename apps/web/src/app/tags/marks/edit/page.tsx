'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import SupportMarkEditor from '@/components/friend-fields/support-mark-editor'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import FeatureGate from '@/components/feature-gate'

function EditSupportMarkPageInner() {
  const id = useSearchParams().get('id')
  /*
    編集ルートで `?id=` が無いと、新規作成の器（/tags/marks/new と同じ）が
    黙って出る。一覧へ戻して編集対象を選び直させる。
  */
  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="編集する対応マークが指定されていません"
        description="一覧から編集する対応マークを選び直してください。"
        backHref="/tags?tab=marks"
        backLabel="対応マークの一覧へ戻る"
      />
    )
  }
  return <SupportMarkEditor markId={id} />
}

export default function EditSupportMarkPage() {
  return <FeatureGate feature="support_marks"><Suspense fallback={<ListState kind="loading" />}><EditSupportMarkPageInner /></Suspense></FeatureGate>
}
