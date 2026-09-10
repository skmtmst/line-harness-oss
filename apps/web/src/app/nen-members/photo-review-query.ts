/*
 * ダッシュボードの「写真審査」から来たときに、どの札を開くかを決める。
 *
 * ダッシュボードは `/nen-members?tab=photos&status=pending_review` へ送る。
 * ここで読まないと、押しても全部の写真が出るだけで「審査待ちだけ見たい」
 * という押した理由が消える（#666 N-004）。
 *
 * 画面の中の呼び名（pending/adopted/rejected）と、URLに書く呼び名は別。
 * URL側は API と同じ `pending_review` などの言い方も受ける。
 */

export type PhotoReviewStatus = 'pending' | 'adopted' | 'rejected'

export interface PhotoReviewEntry {
  view: 'list' | 'publications'
  status: PhotoReviewStatus
}

const STATUS_ALIASES: Record<string, PhotoReviewStatus> = {
  pending: 'pending',
  pending_review: 'pending',
  'pending-review': 'pending',
  review: 'pending',
  adopted: 'adopted',
  approved: 'adopted',
  rejected: 'rejected',
  returned: 'rejected',
}

const DEFAULT_ENTRY: PhotoReviewEntry = { view: 'list', status: 'pending' }

/** URL に書いてある状態の呼び名を、画面の札の名前へ直す。知らない値は null。 */
export function photoReviewStatusFrom(raw: string | null | undefined): PhotoReviewStatus | null {
  if (!raw) return null
  return STATUS_ALIASES[raw.trim().toLowerCase()] ?? null
}

/**
 * `?tab=...&status=...` を読んで、開く画面と札を決める。
 * 知らない値・空のときは、今までどおり一覧の「見ていないもの」。
 */
export function photoReviewEntryFrom(search: string | null | undefined): PhotoReviewEntry {
  if (!search) return DEFAULT_ENTRY
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const tab = params.get('tab')?.trim().toLowerCase() ?? ''
  const status = photoReviewStatusFrom(params.get('status'))
  if (tab === 'publications' || tab === 'published') {
    return { view: 'publications', status: status ?? DEFAULT_ENTRY.status }
  }
  return { view: 'list', status: status ?? DEFAULT_ENTRY.status }
}
