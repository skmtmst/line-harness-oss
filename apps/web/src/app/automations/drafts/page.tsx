'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

import TargetMissing from '@/components/shared/target-missing'
import { usePageTitle } from '@/components/shell/page-chrome'
import { NewAutomationV8 } from '@/v8/automations/create/create'
import AutomationDefinitionEntry from '@/v8/automations/definition-entry'

/* 見本から作った下書き。未指定なら理由を出し、対象IDの変更では編集器を作り直す。 */
function AutomationDraftPageInner() {
  usePageTitle('見本から作った下書き')
  /*
   * R531: 対象IDはURLから反応的に読む。開いたままIDがA→Bへ変わったら、
   * 前の下書きの表示と保存先を残さない。`key` で編集器ごと作り直すので、
   * 古い入力・版・保存先がBへ混ざらない。
   */
  const params = useSearchParams()
  const draftId = params.get('id')
  const automationId = params.get('automationId')

  if (!draftId && automationId) return <AutomationDefinitionEntry key={automationId} automationId={automationId} />

  if (!draftId) {
    return (
      <TargetMissing
        kind="unspecified"
        title="開く下書きが指定されていません"
        description="見本の一覧から選び直してください。下書きは消えていません。"
        backHref="/automations?tab=templates"
        backLabel="見本の一覧へ戻る"
      />
    )
  }

  return <NewAutomationV8 key={draftId} draftId={draftId} chrome="draft" />
}

export default function AutomationDraftPage() {
  return (
    <Suspense fallback={null}>
      <AutomationDraftPageInner />
    </Suspense>
  )
}
