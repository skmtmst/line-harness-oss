import type { AffiliateOffer } from '@/lib/api'

/**
 * 案件一覧の見せ方（設計 `GH8VL`）。
 *
 * 検索・絞り込み・並び替え・ページ送りは、どれも一覧が読み込んだ行から
 * 数えられる。サーバに問い合わせる口はないので、ここで組み立てる。
 * 画面（`tabs.tsx`）に直接書くと、境目（該当0件・ページの最後・空文字の
 * 検索）を試せない。
 */

/** 絞り込み札。読み込んだ行から数えられるものだけ置く。 */
export type OfferFilter = 'open' | 'draft' | 'hasYen' | 'hasMiles'

export const OFFER_FILTERS: Array<{
  key: OfferFilter
  label: string
  match: (offer: AffiliateOffer) => boolean
}> = [
  { key: 'open', label: '公開中', match: (o) => o.isActive },
  { key: 'draft', label: '下書き', match: (o) => !o.isActive },
  { key: 'hasYen', label: '報酬あり', match: (o) => (o.rewardAmount ?? 0) > 0 },
  { key: 'hasMiles', label: 'マイルあり', match: (o) => o.rewardMiles > 0 },
]

export type OfferSort = 'newest' | 'name' | 'reward'

export const OFFER_SORTS: Array<{ value: OfferSort; label: string }> = [
  { value: 'newest', label: '新しい順' },
  { value: 'name', label: '案件名の順' },
  { value: 'reward', label: '報酬が高い順' },
]

export const OFFER_PAGE_SIZES = [20, 50, 100]

/**
 * 絞り込み → 検索 → 並び替え。
 *
 * 札は同じ考えのものを足し合わせる（OR）。「公開中」と「下書き」を両方
 * 押したときに0件になると、押した意味が読めない。
 */
export function selectOffers(
  offers: AffiliateOffer[],
  { filters, query, sort }: { filters: OfferFilter[]; query: string; sort: OfferSort },
): AffiliateOffer[] {
  let rows = offers
  if (filters.length > 0) {
    const picked = OFFER_FILTERS.filter((f) => filters.includes(f.key))
    rows = rows.filter((offer) => picked.some((f) => f.match(offer)))
  }
  const q = query.trim().toLowerCase()
  if (q) {
    rows = rows.filter(
      (offer) =>
        offer.name.toLowerCase().includes(q)
        || (offer.description ?? '').toLowerCase().includes(q),
    )
  }
  const sorted = [...rows]
  if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  else if (sort === 'reward') sorted.sort((a, b) => (b.rewardAmount ?? 0) - (a.rewardAmount ?? 0))
  else sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return sorted
}

/** 何ページに分かれるか。0件でも1ページ（空の一覧を出す）。 */
export function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}

/** 指定ページのぶんだけ切り出す。範囲外のページは最後のページに寄せる。 */
export function pageOf<T>(rows: T[], page: number, pageSize: number): T[] {
  const size = Math.max(1, pageSize)
  const last = pageCountOf(rows.length, size)
  const current = Math.min(Math.max(1, page), last)
  return rows.slice((current - 1) * size, current * size)
}

/** CSVの1セル。改行・カンマ・引用符が入っても列がずれないようにする。 */
export function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const OFFER_CSV_HEADER = [
  '案件名',
  '説明',
  '報酬（円）',
  'マイル',
  '対象アカウント',
  '成果時のタグ',
  '開始するシナリオ',
  '状態',
  '作成日',
]

/**
 * 画面に出ている行をそのまま書き出す。
 *
 * サーバに書き出しの口は無い。一覧は全件を読み込んでいるので、絞り込んだ
 * 結果はここで作れる。名前が引けないIDはIDのまま出す（空欄にすると、
 * 消えたのか元から無いのかが読めない）。
 */
export function offersCsv(
  offers: AffiliateOffer[],
  names: {
    account: (id: string) => string | undefined
    tag: (id: string) => string | undefined
    scenario: (id: string) => string | undefined
    date: (iso: string) => string
  },
): string {
  const lines = [OFFER_CSV_HEADER.join(',')]
  for (const offer of offers) {
    lines.push([
      csvCell(offer.name),
      csvCell(offer.description ?? ''),
      csvCell(offer.rewardAmount ?? ''),
      csvCell(offer.rewardMiles),
      csvCell(offer.lineAccountId ? names.account(offer.lineAccountId) ?? offer.lineAccountId : ''),
      csvCell(offer.tagId ? names.tag(offer.tagId) ?? offer.tagId : ''),
      csvCell(offer.scenarioId ? names.scenario(offer.scenarioId) ?? offer.scenarioId : ''),
      csvCell(offer.isActive ? '公開中' : '下書き'),
      csvCell(names.date(offer.createdAt)),
    ].join(','))
  }
  return lines.join('\r\n')
}
