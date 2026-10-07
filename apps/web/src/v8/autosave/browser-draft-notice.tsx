'use client'

/*
 * 「前の入力を戻す」の帯。共通の帯（Notice）に、戻す操作と閉じる（捨てる）を載せるだけ。
 * 見た目は共通の帯のまま（画面の CSS を足さない）。
 */
import Notice from '@/components/shared/notice'
import Button from '@/components/shared/button'
import { BROWSER_DRAFT_WORDS } from './use-browser-draft'

export function BrowserDraftNotice({
  ago,
  onRestore,
  onDiscard,
}: {
  ago: string | null
  onRestore: () => void
  onDiscard: () => void
}) {
  if (ago === null) return null
  return (
    <Notice
      tone="info"
      data-browser-draft
      message={`${BROWSER_DRAFT_WORDS.restoreTitle(ago)}閉じると消えます。`}
      action={<Button type="button" size="compact" onClick={onRestore}>{BROWSER_DRAFT_WORDS.restore}</Button>}
      onClose={onDiscard}
    />
  )
}
