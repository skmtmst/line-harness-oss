/**
 * 編集保存がほかの人と競合したときの言い方(#723)。
 *
 * 共通情報の編集（`contents/vars/change-impact.ts` の `saveErrorText`）と
 * 同じ言い方に揃える。**保管・削除の「影響が変わりました」は使わない。**
 * あちらは回答や利用先が増えたという意味で、ここは人が先に保存したという
 * 意味なので、混ぜると運用者が次にすることを間違える。
 *
 * ページ本体（`page.tsx`）には置けない。Next のページは決まった名前以外を
 * export できないため。
 */

/** 相手がいつ保存したか。読めない値なら何も言わない（嘘の時刻を出さない）。 */
export function formatSavedAt(updatedAt: string): string {
  if (!updatedAt) return ''
  const parsed = new Date(updatedAt)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(parsed)
}

export function conflictMessage(updatedAt: string): string {
  const when = formatSavedAt(updatedAt)
  return when
    ? `ほかの人が${when}に先に保存しました。最新の内容を読み込んでから、もう一度お試しください。`
    : 'ほかの人が先に保存しました。最新の内容を読み込んでから、もう一度お試しください。'
}
