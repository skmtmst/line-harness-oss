/*
 * 統括の一括配信（提案 E-9）の計算の試験。差し込みの置き換え・確かめの札・送る店と外す店の数・表のまとめ方・結果の札。
 */
import { describe, expect, it } from 'vitest'
import type { HqBroadcastPreflight, HqBroadcastRun } from '@line-crm/shared'
import { canRetry, excludedReason, preflightBadge, previewText, resultBadge, runTitle, scheduledIso, sendTotals, splitPreflightRows, toApiContent } from './model'

const check = (id: string, people: number, remaining: number | null, reasons: string[] = [], excluded = false): HqBroadcastPreflight => ({
  accountId: id, accountName: id, audienceCount: people, remaining, connected: true, paused: reasons.some((r) => r.includes('停止')), blockedReasons: reasons, excluded, broadcastId: null,
})
type Target = HqBroadcastRun['targets'][number]
const target = (c: HqBroadcastPreflight, status: string, total: number, success: number, extra: Partial<Target> = {}): Target => ({
  ...c, status, totalCount: total, successCount: success, version: 1, retryableCount: 0, stopped: false, ...extra,
})

describe('一括配信の計算', () => {
  it('画面の差し込みを口の書き方に置き換える（店名・電話・予約ページ・友だちの名前）', () => {
    expect(toApiContent('{店名}より：{友だちの名前}さん {店の電話番号} → {予約ページ}'))
      .toBe('{{account.name}}より：{{name}}さん {{var.store_phone}} → {{var.reservation_url}}')
  })

  it('見え方の例は店の名前を入れ、予約ページの矢印ごと省く', () => {
    expect(previewText('{店名}より：ご予約は LINE から → {予約ページ}', '銀座店')).toBe('銀座店より：ご予約は LINE から')
  })

  it('配信の名前は本文の1行目から作る（差し込みは除く・40字まで）', () => {
    expect(runTitle('{店名}より：1月の限定メニュー\n2行目')).toBe('より：1月の限定メニュー')
    expect(runTitle('')).toBe('統括の一括配信')
    expect(runTitle('あ'.repeat(50))).toHaveLength(40)
  })

  it('確かめの札：足りる・足りない通数・接続切れ・止めている', () => {
    expect(preflightBadge(check('a', 10, 20)).label).toBe('足りる')
    expect(preflightBadge(check('b', 5880, 2100, ['今月の送信枠が足りません'])).label).toBe('3,780通 足りない')
    expect(preflightBadge(check('c', 1, 1, ['LINEに接続されていません'])).label).toBe('LINE の接続切れ')
    expect(preflightBadge(check('d', 1, 1, ['店舗または配信が停止中'])).label).toBe('配信を止めている')
  })

  it('送る店と外す店の数と人数（外した店・問題のある店は外す側）', () => {
    const totals = sendTotals([check('a', 100, 500), check('b', 50, 10, ['今月の送信枠が足りません']), check('c', 30, 500, [], true)])
    expect(totals).toEqual({ sendStores: 1, sendPeople: 100, skipStores: 2, skipPeople: 80 })
  })

  it('表：外す店は必ず1行ずつ、送る店は合わせて4行まで。残りは「ほか N店」（1店だけならまとめない）', () => {
    const list = [check('ok1', 1, 9), check('ng1', 1, 0, ['今月の送信枠が足りません']), check('ng2', 1, 9, ['LINEに接続されていません']), check('ng3', 1, 9, ['店舗または配信が停止中']), check('ok2', 1, 9), check('ok3', 1, 9)]
    const { shown, rest } = splitPreflightRows(list, 4)
    expect(shown.map((p) => p.accountId)).toEqual(['ok1', 'ng1', 'ng2', 'ng3'])
    expect(rest.map((p) => p.accountId)).toEqual(['ok2', 'ok3'])
    expect(splitPreflightRows(list.slice(0, 5), 4).rest).toEqual([])
  })

  it('結果の札：送れた・失敗・外した理由・取り消した', () => {
    expect(resultBadge(target(check('a', 10, 9), 'sent', 10, 8)).label).toBe('送れた')
    expect(resultBadge(target(check('b', 10, 9), 'failed', 10, 0)).label).toBe('失敗')
    expect(resultBadge(target(check('c', 10, 1, ['今月の送信枠が足りません'], true), 'excluded', 0, 0)).label).toBe('外した（枠が足りない）')
    expect(resultBadge(target(check('d', 10, 9), 'cancelled', 0, 0)).label).toBe('取り消した')
    expect(excludedReason(check('e', 1, 1))).toBe('')
  })

  it('やり直せるのは一時的な失敗が残る店か失敗した店だけ。取り消した配信・外した店はやり直せない', () => {
    const failed = target(check('a', 10, 9), 'failed', 10, 0, { broadcastId: 'b-1' })
    const sent = target(check('b', 10, 9), 'sent', 10, 10, { broadcastId: 'b-2' })
    expect(canRetry({ status: 'scheduled' }, failed)).toBe(true)
    expect(canRetry({ status: 'scheduled' }, sent)).toBe(false)
    expect(canRetry({ status: 'scheduled' }, { ...sent, retryableCount: 3 })).toBe(true)
    expect(canRetry({ status: 'cancelled' }, failed)).toBe(false)
  })

  it('予約の日時は日付と時刻から作る。形が違えば null', () => {
    expect(scheduledIso('2027-01-15', '11:00')).toBe(new Date('2027-01-15T11:00:00').toISOString())
    expect(scheduledIso('2027/01/15', '11:00')).toBeNull()
  })
})
