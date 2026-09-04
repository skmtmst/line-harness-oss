'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'

import AutomationDraftEditor from '@/components/automations/automation-draft-editor'
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
  const [draftId, setDraftId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    setDraftId(new URLSearchParams(window.location.search).get('id'))
  }, [])

  /* 読み終えるまでは何も描かない。一瞬だけ「ありません」が見えるのを避ける。 */
  if (draftId === undefined) return null

  if (!draftId) {
    return (
      <div className="rounded-card border-hairline bg-canvas border p-8 text-center">
        <p className="text-ink text-sm font-bold">どの下書きかが指定されていません</p>
        <p className="text-ink-secondary mt-2 text-xs leading-5">
          見本の一覧から選び直してください。下書きは消えていません。
        </p>
        <Link
          href="/automations?tab=templates"
          className="text-accent mt-4 inline-block text-sm font-medium underline"
        >
          見本の一覧へ
        </Link>
      </div>
    )
  }

  return <AutomationDraftEditor draftId={draftId} />
}

export default function AutomationDraftPage() {
  return (
    <Suspense fallback={null}>
      <AutomationDraftPageInner />
    </Suspense>
  )
}
