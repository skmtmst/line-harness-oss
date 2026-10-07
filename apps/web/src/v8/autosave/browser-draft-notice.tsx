'use client'

/*
 * 「前の入力を戻す」の帯。共通の帯（Notice）に、戻す操作と閉じる（捨てる）を載せるだけ。
 * 見た目は共通の帯のまま（画面の CSS を足さない）。
 */
import Notice from '@/components/shared/notice'
import Button from '@/components/shared/button'
import { BROWSER_DRAFT_WORDS } from './use-browser-draft'
import { SCENARIO_DRAFT_WORDS } from './use-scenario-draft'

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

/**
 * 下書きの競合の帯（シナリオの下書きの口が 409 を返したとき）。共通の帯のまま、
 * 「最新の下書きを読み込む」を載せ、閉じる（×）を「自分の入力で上書きする」にする。
 * 帯は操作を1つまでの決まりなので、もう1つは閉じるに当てる。どちらかを選ぶまで上書きしない。
 */
export function ScenarioDraftConflictNotice({
  ago,
  onLoadLatest,
  onOverwrite,
}: {
  ago: string | null
  onLoadLatest: () => void
  onOverwrite: () => void
}) {
  if (ago === null) return null
  return (
    <Notice
      tone="warn"
      role="alert"
      data-scenario-draft-conflict
      message={`${SCENARIO_DRAFT_WORDS.conflict(ago)}${SCENARIO_DRAFT_WORDS.closeToOverwrite}`}
      action={<Button type="button" size="compact" onClick={onLoadLatest}>{SCENARIO_DRAFT_WORDS.loadLatest}</Button>}
      onClose={onOverwrite}
    />
  )
}
