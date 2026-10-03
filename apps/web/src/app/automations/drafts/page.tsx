'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

import AutomationDraftEditor from '@/components/automations/automation-draft-editor'
import TargetMissing from '@/components/shared/target-missing'
import { usePageTitle } from '@/components/shell/page-chrome'

/*
  見本から作った下書きの編集面。

  **「ルールを作る」（`Rv8Jv`）とは別の画面にした。** 見本を押すとサーバー側で
  下書きができるので、白紙から作る画面とは出発点が違う。同じ画面に混ぜると、
  設計の `Rv8Jv` の骨格に下書き側の節が混ざり、どちらの画面を見ているのか
  読めなくなる（`design-structure.test.ts` が節の食い違いで落ちる）。

  番号が付いていないときは、白紙の作成画面へ送らずに**理由を出す**。
  黙って別の画面へ飛ばすと、下書きが消えたのか元から無いのかが分からない。
*/
function AutomationDraftPageInner() {
  usePageTitle('見本から作った下書き')
  /*
   * R531: 対象IDはURLから反応的に読む。開いたままIDがA→Bへ変わったら、
   * 前の下書きの表示と保存先を残さない。`key` で編集器ごと作り直すので、
   * 古い入力・版・保存先がBへ混ざらない。
   */
  const draftId = useSearchParams().get('id')

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

  return <AutomationDraftEditor key={draftId} draftId={draftId} />
}

export default function AutomationDraftPage() {
  return (
    <Suspense fallback={null}>
      <AutomationDraftPageInner />
    </Suspense>
  )
}
