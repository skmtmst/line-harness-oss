/**
 * M003：保存の応答消失後の再送か、ほかの人の編集かを分けるための内容比べ。
 *
 * 保存は確認した版（`expectedContentRevision`）で守られている。初回は通ったが
 * 応答だけ失った再送は、版が1つ進んでいるため409になる。送った中身と
 * いま保存されている中身が同じなら自分の再送であり、「ほかの人が先に
 * 保存しました」ではない。
 *
 * 鍵の順序が違っても同じとみなす（運用者の入力とサーバの保存形で
 * 並びが変わっても比べられるように）。比べるのは利用者の入力だけ。
 * 版・時刻・IDは比べない。
 *
 * ページ本体（`page.tsx`）には置けない。Next のページは決まった名前以外を
 * export できないため（`form-conflict-message.ts` と同じ理由）。
 */

import type { FormLayout, LiffFormAppearance } from '@line-crm/shared'

export type FormSavedContent = {
  name: string
  description: string | null
  layout: FormLayout
  onSubmitTagId: string | null
  isActive: boolean
  ogTitle: string | null
  ogDescription: string | null
  ogImageUrl: string | null
  /** 見た目（M3）。比べないと見た目だけの保存の再送を見分けられない。 */
  liffAppearance: LiffFormAppearance
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** 送った中身と保存されている中身が同じなら true（自分の再送）。 */
export function formSavedContentMatches(sent: FormSavedContent, current: FormSavedContent): boolean {
  return canonicalize(sent) === canonicalize(current)
}
