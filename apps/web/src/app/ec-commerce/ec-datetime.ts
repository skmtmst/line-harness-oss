'use client'

/**
 * EC連携3画面の日付表示（#517 軽）。
 * `page.tsx`・`connector-panel.tsx`・`subscriptions-panel.tsx` で
 * 別々に書いていた整形をここへ寄せる。出し方は変えない。
 * 未取得・壊れた値は `—`（呼び側の「未取得」文言はそのまま）。
 */

function formatInvalidAsDash(date: Date, format: (date: Date) => string): string {
  if (Number.isNaN(date.valueOf())) return '—'
  return format(date)
}

/** 年なし日時（例: 8/25 14:30）。一覧向き。 */
export function formatEcDateTime(value: string | null): string {
  if (!value) return '—'
  return formatInvalidAsDash(new Date(value), (date) =>
    new Intl.DateTimeFormat('ja-JP', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date))
}

/** 年あり日時（例: 2026/8/25 14:30）。つなぎ先の記録向き。 */
export function formatEcDateTimeWithYear(value: string | null): string {
  if (!value) return '—'
  return formatInvalidAsDash(new Date(value), (date) =>
    new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date))
}

/** 月日のみ（例: 8/25）。定期便の次回発送向き。 */
export function formatEcShortDate(value: string | null): string {
  if (!value) return '—'
  return formatInvalidAsDash(new Date(value), (date) =>
    new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(date))
}
