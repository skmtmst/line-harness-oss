/*
 * ★V8 回答フォームの一覧で使う型と小さな決まり。
 * 今までの V8 一覧（app/form-submissions/list-v8.tsx）から写した（src/v8 からは @/app を読めないため）。
 * 並び・絞り込み・保存先の数え方の正本は @line-crm/shared（Worker と同じ規則）。
 */
import {
  displayFormName,
  sortFormsByLatestAnswer,
  summarizeFormDestinations,
  type FormLayout,
} from '@line-crm/shared'
import type { FormDeleteImpact } from '@/lib/api'
import { formatNumber } from '@/lib/format'

export interface UsedByAccount {
  id: string
  name: string
  country: string | null
  displayOrder: number
  count: number
}

export interface Form {
  id: string
  name: string
  description: string | null
  fields: Array<{ name: string; label: string; type?: string }>
  layout: FormLayout
  onSubmitTagId: string | null
  isActive: boolean
  status: 'active' | 'archived'
  revision: number
  submitCount?: number
  monthlySubmitCount?: number | null
  monthlyOpenCount?: number | null
  monthlyCompletionRate?: number | null
  /** 後処理が失敗したか途中で止まった回答の数（一覧の未完の札）。 */
  pendingPostActionCount?: number | null
  folderId?: string | null
  destinationSummary?: { friendFieldCount: number; tagCount: number }
  createdAt: string
  updatedAt: string | null
  lastSubmittedAt: string | null
  usedByAccounts: UsedByAccount[]
  accountScopeReviewRequired?: boolean
}

/** 「未分類」の送り値。`GET /api/forms` の `folder_id=unfiled` と同じ。 */
export const UNFILED_VALUE = 'unfiled'

export type FormListResponse = Form[] | {
  items: Form[]
  /** 絞り込み後の総件数（ページ送りの母数）。 */
  total: number
  /** フォルダ範囲だけの総件数（フォルダ欄の「すべて」）。 */
  all_total?: number
  page: number
  limit: number
}

/** 絞り込み札。「後処理未完」は数の帯の「未完を見る」から入る。 */
export type FormFilter = 'all' | 'published' | 'draft' | 'stored' | 'pending'
export type FormSort = 'latest-answer' | 'answers' | 'updated' | 'name'

/** 表示件数（決まり：ページ送りのある一覧は 10・20・50 件）。 */
export const FORM_PAGE_SIZES = [10, 20, 50] as const

export const SORT_OPTIONS: Array<{ value: FormSort; label: string }> = [
  { value: 'latest-answer', label: '最新の回答順' },
  { value: 'answers', label: '回答が多い順' },
  { value: 'updated', label: '更新が新しい順' },
  { value: 'name', label: '名前順' },
]

export function formAnswerCount(form: Form): number {
  return form.submitCount ?? form.usedByAccounts.reduce((sum, account) => sum + account.count, 0)
}

export function validSort(value: string | null): FormSort {
  return value === 'answers' || value === 'updated' || value === 'name' ? value : 'latest-answer'
}

export function validFilter(value: string | null): FormFilter {
  return value === 'published' || value === 'draft' || value === 'stored' || value === 'pending'
    ? value
    : 'all'
}

export function validPageSize(value: string | null): number {
  const parsed = Number(value)
  return FORM_PAGE_SIZES.includes(parsed as (typeof FORM_PAGE_SIZES)[number]) ? parsed : 20
}

export function validPage(value: string | null): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

/** 一覧の状態を URL の指定へ（今までと同じ名前・同じ既定値は省く）。 */
export function listQueryString(state: {
  query: string
  filter: FormFilter
  sort: FormSort
  pageSize: number
  page: number
}): string {
  const params = new URLSearchParams()
  if (state.query) params.set('q', state.query)
  if (state.filter !== 'all') params.set('filter', state.filter)
  if (state.sort !== 'latest-answer') params.set('sort', state.sort)
  if (state.pageSize !== 20) params.set('limit', String(state.pageSize))
  if (state.page !== 1) params.set('page', String(state.page))
  return params.toString()
}

function compareDatesNewest(first: string | null | undefined, second: string | null | undefined): number {
  if (first && second) return new Date(second).getTime() - new Date(first).getTime()
  if (first) return -1
  if (second) return 1
  return 0
}

/** 管理者確認（全件が来る口）だけ手元で並べる。通常一覧は Worker が並べた1ページ分。 */
export function sortForms(forms: Form[], sort: FormSort): Form[] {
  if (sort === 'latest-answer') return sortFormsByLatestAnswer(forms)
  return [...forms].sort((first, second) => {
    if (sort === 'answers') {
      const countDifference = formAnswerCount(second) - formAnswerCount(first)
      if (countDifference !== 0) return countDifference
      return compareDatesNewest(first.updatedAt, second.updatedAt) || first.id.localeCompare(second.id)
    }
    if (sort === 'updated') {
      return compareDatesNewest(first.updatedAt, second.updatedAt) || first.id.localeCompare(second.id)
    }
    return displayFormName(first.name).localeCompare(displayFormName(second.name), 'ja-JP') || first.id.localeCompare(second.id)
  })
}

/** 配っている公開URL（LIFF）。アカウントの liffId が無いと作れない。 */
export function formAnswerUrl(liffId: string | null | undefined, formId: string): string | null {
  if (!liffId) return null
  return `https://liff.line.me/${liffId}/?page=form&id=${encodeURIComponent(formId)}`
}

/** 「保存先」列。`友だち情報 3・タグ 2` の形。何も保存しないときは —。 */
export function destinationText(form: Form): string {
  const summary = form.destinationSummary ?? summarizeFormDestinations(form.layout, form.onSubmitTagId)
  const parts = [
    summary.friendFieldCount > 0 ? `友だち情報 ${summary.friendFieldCount}` : '',
    summary.tagCount > 0 ? `タグ ${summary.tagCount}` : '',
  ].filter(Boolean)
  return parts.join('・') || '—'
}

/** 名前の下の説明行。説明があれば「説明・Nブロック」、無ければ「Nブロック」。 */
export function subLineText(form: Form): string {
  const blocks = `${form.fields.length}ブロック`
  if (form.description) return form.fields.length > 0 ? `${form.description}・${blocks}` : form.description
  return blocks
}

/** 回答の列の2行目。取れていない数は「—」（0 とは言わない）。 */
export function answerSubText(form: Form): string {
  const monthly = form.monthlySubmitCount == null ? '—' : formatNumber(form.monthlySubmitCount)
  const rate = form.monthlyCompletionRate == null ? '—' : `${formatNumber(form.monthlyCompletionRate)}%`
  return `今月 ${monthly}・完了 ${rate}`
}

/** アーカイブ・削除の窓の注意文の利用先（リッチメニュー「…」とシナリオ「…」の形）。 */
export function referenceLabel(reference: FormDeleteImpact['references'][number]): string {
  const name = reference.name ?? '名前を確認できない利用先'
  if (reference.kind === 'rich_menu') return `リッチメニュー「${name}」`
  if (reference.kind === 'webinar') return `ウェビナー「${name}」`
  if (reference.kind === 'scenario') return `シナリオ「${name}」`
  return `「${name}」`
}
