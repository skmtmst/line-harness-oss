/*
 * ★V8 成果とアフィリエイトの表示の言い換えと、読み込みの小さな手助け。
 *
 * 写し元：app/affiliates/tabs.tsx（型・配布URL・承認の全件読み）、
 * affiliate-reward.ts・offer-list-view.ts・offer-kpi.ts・report-period.ts・
 * payment-tab.tsx（締めの期間）・affiliate-display.ts（確かめる理由）。
 * src/v8 は @/app を import できないので、同じ中身をここに写した。
 * 動きは写し元と同じ（変えるときは両方を直す）。
 */
import { api, type ConversionApprovalItem } from '@/lib/api'
import { formatDay, formatNumber } from '@/lib/format'

export interface AffiliateItem {
  id: string
  name: string
  code: string
  commissionRate: number
  isActive: boolean
  createdAt: string
  friendId: string | null
  email?: string | null
  holdDays?: number | null
  payoutCycle?: string | null
  notifyOnConversion?: boolean
}

/** 一覧の1行（登録＋集計）。 */
export interface AffiliateListRow extends AffiliateItem {
  totalClicks: number
  totalConversions: number
  totalRevenue: number
  rewardAmount: number
  linkCount: number
  friendAdds: number
}

export interface AffiliateReportRow {
  affiliateId: string
  affiliateName?: string
  code?: string
  commissionRate?: number
  totalClicks: number
  totalConversions: number
  totalRevenue: number
  confirmedReward: number
  linkCount: number
  friendAdds: number
}

export interface AffiliateLink {
  id: string
  affiliate_id?: string
  ref_code: string
  label: string | null
  line_account_id?: string | null
  is_active: number | boolean
  created_at?: string
  click_count: number
  conversions?: number
  offer_id: string | null
  offer_name: string | null
}

export interface ReportV2 {
  affiliateId: string
  affiliateName: string
  code: string
  commissionRate: number
  clicks: number
  linkClicks: number
  friendAdds: number
  conversions: number
  conversionsPending: number
  conversionsApproved: number
  conversionsRejected: number
  conversionsByPoint: Array<{ conversionPointId: string; name: string; count: number; value: number }>
  revenue: number
  estimatedCommission: number
  confirmedReward: number
  byOffer: Array<{
    offerId: string
    offerName: string
    rewardAmount: number
    conversionsApproved: number
    conversionsPending: number
    confirmedReward: number
  }>
  duplicateFlags: Array<{ friendId: string; identityKey: string }>
}

/** 集計の返事が数として読めるか。読めないときは null（0で埋めない）。 */
export function asReportV2(raw: unknown): ReportV2 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Partial<ReportV2>
  const numbers: Array<number | undefined> = [
    value.clicks, value.friendAdds, value.conversions,
    value.conversionsApproved, value.conversionsPending, value.conversionsRejected,
    value.confirmedReward,
  ]
  if (numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null
  if (!Array.isArray(value.byOffer) || !Array.isArray(value.conversionsByPoint)) return null
  return value as ReportV2
}

export function formatYen(n: number): string {
  return `¥${formatNumber(Math.round(n))}`
}

export function formatYenNullable(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return formatYen(n)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDay(date)
}

/** 「9/30 14:12」（日本時間）。 */
export function formatMonthDayTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '—'
  const jst = new Date(ms + 9 * 3600_000)
  const hh = String(jst.getUTCHours()).padStart(2, '0')
  const mm = String(jst.getUTCMinutes()).padStart(2, '0')
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${hh}:${mm}`
}

/** 「10/31」（日本時間）。 */
export function formatMonthDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '—'
  const jst = new Date(ms + 9 * 3600_000)
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`
}

/*
 * 既存リンクの配布URL。Worker の `resolveLinkBaseUrl` と同じ優先順位。
 * 1. 管理画面で決めた短縮ドメイン（`link_base_url`）があれば、その直下。
 * 2. 無ければ Worker の `/r/`。
 */
const WORKER_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')

export function distributionUrl(refCode: string, customBase: string | null): string {
  if (typeof customBase === 'string' && customBase) return `${customBase.replace(/\/$/, '')}/${refCode}`
  if (WORKER_BASE) return `${WORKER_BASE}/r/${encodeURIComponent(refCode)}`
  return ''
}

/*
 * 承認の一覧は打ち切らない。短い頁が返るまで送って全件取る。
 * 安全弁として 25 頁（5000 件）で止め、そのときは打ち切ったことを返す。
 */
const APPROVAL_PAGE_SIZE = 200
const APPROVAL_MAX_PAGES = 25

async function fetchAllConversionApprovals(
  status: 'pending' | 'approved' | 'rejected',
  startOffset: number,
): Promise<{ items: ConversionApprovalItem[]; truncated: boolean }> {
  const items: ConversionApprovalItem[] = []
  for (let page = 0; page < APPROVAL_MAX_PAGES; page += 1) {
    const res = await api.conversionApprovals.list({
      status,
      limit: APPROVAL_PAGE_SIZE,
      offset: startOffset + page * APPROVAL_PAGE_SIZE,
    })
    if (!res.success) throw new Error('承認の読み込みに失敗しました。もう一度読み込んでください。')
    items.push(...res.data)
    if (res.data.length < APPROVAL_PAGE_SIZE) return { items, truncated: false }
  }
  return { items, truncated: true }
}

/*
 * WEB003: 同じ条件（アカウント・状態・始まりの位置）で走っている全件読みは1本にまとめる。
 * タブの名の横の件数（affiliates.tsx）と成果承認タブ（approvals.tsx）が同時に開くと、
 * 承認待ちの全件読みが2本重なっていた。終わった結果は持ち越さない（次に呼べば読み直す）。
 * 承認・却下の後は `fresh` で読み直し、操作より前に始まった読み込みを使い回さない。
 */
const runningApprovalLoads = new Map<string, Promise<{ items: ConversionApprovalItem[]; truncated: boolean }>>()

export function listAllConversionApprovals(
  status: 'pending' | 'approved' | 'rejected',
  startOffset = 0,
  options: { accountId?: string | null; fresh?: boolean } = {},
): Promise<{ items: ConversionApprovalItem[]; truncated: boolean }> {
  const key = `${options.accountId ?? ''}\u0000${status}\u0000${startOffset}`
  const running = options.fresh ? undefined : runningApprovalLoads.get(key)
  if (running) return running
  const request = fetchAllConversionApprovals(status, startOffset)
  runningApprovalLoads.set(key, request)
  const forget = () => { if (runningApprovalLoads.get(key) === request) runningApprovalLoads.delete(key) }
  request.then(forget, forget)
  return request
}

/**
 * 報酬は2つの決め方のどちらか。割合が正なら売上×割合、
 * そうでなければ認めた成果と案件の額から出した定額の合計。
 */
export function calculateAffiliateReward({
  commissionRate,
  totalRevenue,
  confirmedFixedReward,
}: {
  commissionRate: number
  totalRevenue: number
  confirmedFixedReward: number
}): number {
  if (commissionRate > 0) return (totalRevenue * commissionRate) / 100
  return confirmedFixedReward
}

/** 報酬の約束の一行。登録の値から言えることだけ書く。 */
export function planText(row: { commissionRate: number; isActive: boolean; rewardAmount?: number }): string {
  if (!row.isActive) return '止めている'
  if (row.commissionRate > 0) return `売上の ${row.commissionRate}%`
  if ((row.rewardAmount ?? 0) > 0) return '1件ごと（案件の額）'
  return '報酬なし（計測のみ）'
}

/** 何ページに分かれるか。0件でも1ページ。 */
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

/** CSVの1セル。数式として実行されないよう、=+-@ で始まる値の前に ' を付ける。 */
export function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value)
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** 行を CSV にして保存させる（Excel で開けるよう BOM 付き）。 */
export function downloadCsv(fileName: string, rows: Array<Array<string | number | null | undefined>>): void {
  const csv = rows.map((line) => line.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 締め期間は日本時間の暦月で固定する（見る場所で範囲が変わらないように）。 */
export function currentSettlementPeriod(now = new Date()): { periodFrom: string; periodTo: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric' }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const JST_MS = 9 * 60 * 60 * 1000
  return {
    periodFrom: new Date(Date.UTC(year, month - 1, 1) - JST_MS).toISOString(),
    periodTo: new Date(Date.UTC(year, month, 1) - JST_MS - 1).toISOString(),
  }
}

/** 締めの月の1つ前の期間。 */
export function previousSettlementPeriod(periodFrom: string): { periodFrom: string; periodTo: string } {
  const JST_MS = 9 * 60 * 60 * 1000
  const wall = new Date(new Date(periodFrom).getTime() + JST_MS)
  const year = wall.getUTCFullYear()
  const month = wall.getUTCMonth()
  return {
    periodFrom: new Date(Date.UTC(year, month - 1, 1) - JST_MS).toISOString(),
    periodTo: new Date(Date.UTC(year, month, 1) - JST_MS - 1).toISOString(),
  }
}

/** 「10/1〜10/31」。 */
export function periodText(period: { periodFrom: string; periodTo: string }): string {
  return `${formatMonthDay(period.periodFrom)}〜${formatMonthDay(period.periodTo)}`
}

/** 日本時間の年月（YYYY-MM）。月の境目は日本時間で決める。 */
export function jstMonthKey(at: string | number = Date.now()): string {
  const ms = typeof at === 'number' ? at : new Date(at).getTime()
  if (!Number.isFinite(ms)) return ''
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 7)
}

export type ReportPeriod = 'this_month' | 'last_month' | 'all'

export function reportMonthKey(shift: number, now = Date.now()): string {
  const jst = new Date(now + 9 * 3600_000)
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + shift, 1)).toISOString().slice(0, 7)
}

export function reportPeriodLabel(period: ReportPeriod, now = Date.now()): string {
  if (period === 'all') return 'すべての期間'
  const key = reportMonthKey(period === 'this_month' ? 0 : -1, now)
  const [year, month] = key.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${period === 'this_month' ? '今月' : '先月'}（${month}/1〜${month}/${lastDay}）`
}

/** 期間の頭と終わり（日本時間の月）。all は null。 */
export function reportRange(period: ReportPeriod, now = Date.now()): { startDate: string; endDate: string } | null {
  if (period === 'all') return null
  const key = reportMonthKey(period === 'this_month' ? 0 : -1, now)
  const [year, month] = key.split('-').map(Number)
  const JST_MS = 9 * 60 * 60 * 1000
  return {
    startDate: new Date(Date.UTC(year, month - 1, 1) - JST_MS).toISOString(),
    endDate: new Date(Date.UTC(year, month, 1) - JST_MS - 1).toISOString(),
  }
}

/** 先月との差の言い方（+7・−2・同じ）。 */
export function deltaText(delta: number | null, unit = ''): string {
  if (delta == null) return '先月の数はまだありません'
  if (delta === 0) return '先月と同じ'
  return `先月より ${delta > 0 ? '+' : '−'}${formatNumber(Math.abs(delta))}${unit}`
}

const ORDER_STATUS_TEXT: Record<'refunded' | 'cancelled', string> = { refunded: '返金済み', cancelled: '取り消し済み' }

/** まとめて認めず人が見る成果の理由（同じ友だち・同じ注文の重複・返金や取り消し）。 */
export function approvalReviewReasons(item: {
  duplicateFlag: boolean
  sameOrderDuplicate?: boolean
  orderStatus?: 'current' | 'refunded' | 'cancelled' | null
}): string[] {
  const reasons: string[] = []
  if (item.duplicateFlag) reasons.push('同じ友だちの重複')
  if (item.sameOrderDuplicate) reasons.push('同じ注文の重複')
  if (item.orderStatus === 'refunded' || item.orderStatus === 'cancelled') reasons.push(`注文は${ORDER_STATUS_TEXT[item.orderStatus]}`)
  return reasons
}

/** 名前が取れなかった人。空欄にせず、取れなかったと分かる言葉にする。 */
export function personName(name: string | null | undefined): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed || '名前を確認できません'
}
