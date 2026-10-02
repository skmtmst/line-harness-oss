'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import SupportMarkEditor from '@/components/friend-fields/support-mark-editor'
import MarkEditorV8 from '@/app/tags/mark-editor-v8'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import FeatureGate from '@/components/feature-gate'
import { useAdminTheme } from '@/lib/use-admin-theme'

function EditSupportMarkPageInner() {
  const id = useSearchParams().get('id')
  const theme = useAdminTheme()
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
  return theme === 'v8' ? <MarkEditorV8 markId={id} /> : <SupportMarkEditor markId={id} />
}

export default function EditSupportMarkPage() {
  return <FeatureGate feature="support_marks"><Suspense fallback={<ListState kind="loading" />}><EditSupportMarkPageInner /></Suspense></FeatureGate>
}
