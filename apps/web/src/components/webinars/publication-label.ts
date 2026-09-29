/**
 * 公開状態の日本語表示。3画面で別実装になっていた分岐の正本。
 *
 * 一覧(`app/webinars/page.tsx`)・公開完了(`app/webinars/published/page.tsx`)・
 * 編集(`app/webinars/edit/page.tsx`)が `always/scheduled/ended/unset/period`
 * の5枝をそれぞれ持っていて、仕様変更時に3か所直しが必要だった。
 * 5枝の決まりだけここに寄せ、決まらないとき(未対応の状態・壊れた日付)の
 * 落としどころは各画面に残す(`null` を返したら画面側の fallback へ)。
 */

export type WebinarPublicationState =
  | 'always'
  | 'scheduled'
  | 'ended'
  | 'unset'
  | 'period'

export function formatPublicationDate(
  value: string | null | undefined,
  withTime = false,
): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const dateText = date.toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  })
  if (!withTime) return dateText
  const time = date.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
  })
  return `${dateText} ${time}`
}

export function publicationStateLabel(
  state: WebinarPublicationState | string | null | undefined,
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
): string | null {
  if (state === 'always') return '常時公開'
  if (state === 'scheduled') return formatPublicationDate(startsAt, true) ?? '—'
  if (state === 'ended') return '公開終了'
  if (state === 'unset') return '未設定'
  if (state === 'period') {
    const start = formatPublicationDate(startsAt)
    const end = formatPublicationDate(endsAt)
    if (start && end) return `${start}〜${end}`
  }
  return null
}
