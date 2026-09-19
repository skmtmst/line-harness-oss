import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  autoReplyMatchesQuery,
  conditionChips,
  keywordRules,
  stopNote,
  triggerSummary,
} from './auto-reply-words'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')

const baseRule = {
  keyword: '予約',
  matchType: 'contains' as const,
  name: null,
  responseContent: 'ご予約を承ります',
  keywords: null,
  respondToAll: false,
  keywordMatchMode: 'any',
  activeFrom: null,
  activeUntil: null,
  responseWeekdays: null,
  responseHolidayRule: null,
  cooldownMinutes: null,
  skipWhenOperatorActive: false,
  oncePerFriend: false,
  messageKinds: null,
  friendConditions: null,
}

describe('機能08 点検: 一覧の行停止（E-01・N-086）', () => {
  it('行の操作に停止ボタンがあり、専用の停止口へ確認キーと理由を付けて投げる', () => {
    expect(PAGE).toContain("kind: 'stop'")
    expect(PAGE).toContain('api.autoReplies.stop(')
    expect(PAGE).toContain('crypto.randomUUID()')
    expect(API).toContain('/api/auto-replies/${id}/stop')
    expect(API).toContain("'Idempotency-Key': idempotencyKey")
  })

  it('停止の確認窓は理由（任意）を記録に残せる', () => {
    expect(PAGE).toContain('停止の理由（任意・記録に残ります）')
    expect(PAGE).toContain('maxLength={500}')
    expect(PAGE).toContain('いつ・誰が・なぜ止めたかが記録に残り')
  })

  it('止まっている行には再開ボタンがあり、未公開の下書きには出さない', () => {
    expect(PAGE).toContain("kind: 'resume'")
    expect(PAGE).toContain("r.lifecycleStatus !== 'draft'")
    expect(PAGE).toContain('{ isActive: true }')
  })

  it('停止の記録は状態チップの title で読める', () => {
    expect(PAGE).toContain('stopNote(r)')
    expect(stopNote({
      isActive: false,
      stoppedAt: '2026-09-15T10:23:45.000',
      stoppedByStaffName: '管理者',
      stopReason: '一時停止',
    })).toBe('2026-09-15 10:23 に 管理者 が停止 — 理由: 一時停止')
    // 動いている行・記録の無い行には出さない。
    expect(stopNote({
      isActive: true,
      stoppedAt: '2026-09-15T10:23:45.000',
      stoppedByStaffName: '管理者',
      stopReason: null,
    })).toBeNull()
    expect(stopNote({
      isActive: false,
      stoppedAt: null,
      stoppedByStaffName: null,
      stopReason: null,
    })).toBeNull()
  })
})

describe('機能08 点検: 一覧検索（N-087）', () => {
  it('一覧は検索の部品を言葉の表から使う', () => {
    expect(PAGE).toContain('autoReplyMatchesQuery(r, query)')
  })

  it('大文字小文字を区別しない', () => {
    const rule = { ...baseRule, keyword: 'Coupon' }
    expect(autoReplyMatchesQuery(rule, 'coupon')).toBe(true)
    expect(autoReplyMatchesQuery(rule, 'COUPON')).toBe(true)
    expect(autoReplyMatchesQuery({ ...baseRule, name: 'Campaign' }, 'campaign')).toBe(true)
  })

  it('複数言葉の中身も探せる', () => {
    const rule = {
      ...baseRule,
      keyword: '予約',
      keywords: [
        { keyword: 'キャンペーン', matchType: 'contains' },
        { keyword: 'SALE', matchType: 'exact' },
      ],
    }
    expect(autoReplyMatchesQuery(rule, 'キャン')).toBe(true)
    expect(autoReplyMatchesQuery(rule, 'sale')).toBe(true)
    expect(autoReplyMatchesQuery(rule, '無い言葉')).toBe(false)
  })

  it('空の検索は絞り込まない', () => {
    expect(autoReplyMatchesQuery(baseRule, '')).toBe(true)
    expect(autoReplyMatchesQuery(baseRule, '   ')).toBe(true)
  })
})

describe('機能08 点検: どんなときに動くか列（N-088）', () => {
  it('一覧は先頭の1語ではなく実情報の要約を出す', () => {
    expect(PAGE).toContain('triggerSummary(r)')
    expect(PAGE).toContain('conditionChips(r)')
  })

  it('複数の言葉は件数込みで出し、全文は title で読める', () => {
    const summary = triggerSummary({
      ...baseRule,
      keywords: [
        { keyword: '予約', matchType: 'exact' },
        { keyword: '変更', matchType: 'contains' },
        { keyword: '取消', matchType: 'contains' },
      ],
      keywordMatchMode: 'all',
    })
    expect(summary.text).toBe('「予約」「変更」ほか1件')
    expect(summary.title).toContain('完全一致「予約」')
    expect(summary.title).toContain('部分一致「変更」')
    expect(summary.title).toContain('すべてに当たると動きます')
  })

  it('1語のときはその言葉、一律応答はすべてのメッセージを出す', () => {
    expect(triggerSummary(baseRule).text).toBe('「予約」')
    expect(triggerSummary({ ...baseRule, respondToAll: true }).text).toBe('すべてのメッセージ')
    expect(keywordRules(baseRule)).toEqual([{ keyword: '予約', matchType: 'contains' }])
  })

  it('条件チップは時間系だけでなく曜日・祝日・1人1回・友だち条件も出す', () => {
    const chips = conditionChips({
      ...baseRule,
      activeFrom: '09:00',
      activeUntil: '18:00',
      responseWeekdays: [1, 3, 5],
      responseHolidayRule: 'exclude',
      cooldownMinutes: 30,
      oncePerFriend: true,
      skipWhenOperatorActive: true,
      friendConditions: { field: 'tag' },
      messageKinds: ['text'],
    })
    expect(chips).toContain('09:00〜18:00')
    expect(chips).toContain('月・水・金曜のみ')
    expect(chips).toContain('祝日は止める')
    expect(chips).toContain('30分あけて')
    expect(chips).toContain('同じ人に1回だけ')
    expect(chips).toContain('対応中は止める')
    expect(chips).toContain('友だち条件あり')
    expect(chips).toContain('テキストのみ')
    // 設定の無いものは出さない。
    expect(conditionChips(baseRule)).toEqual([])
  })
})
