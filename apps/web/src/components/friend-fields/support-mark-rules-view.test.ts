import { describe, expect, it } from 'vitest'
import type { SupportMarkAutomationRule } from '@/lib/api'
import {
  EVENT_LABELS,
  LIST_EMPTY,
  LIST_ERROR,
  MULTI_MATCH_NOTE,
  NOT_AVAILABLE,
  PRIORITY_MAX,
  PRIORITY_MIN,
  PROTECTION_MAX,
  eventLabel,
  failureOf,
  inExecutionOrder,
  isCurrentResponse,
  protectionText,
  saveCallOf,
  toRuleBody,
  validateRule,
} from './support-mark-rules-view'

const rule = (over: Partial<SupportMarkAutomationRule> = {}): SupportMarkAutomationRule => ({
  id: 'rule-1',
  name: '担当者が決まったら対応中へ',
  markId: 'mark-hold',
  event: 'staff_assigned',
  condition: null,
  priority: 100,
  manualProtectionMinutes: 60,
  isActive: true,
  version: 2,
  updatedAt: '2026-08-31T10:00:00+09:00',
  ...over,
})

describe('きっかけ', () => {
  it('Workerの5つと同じ', () => {
    expect(EVENT_LABELS.map((e) => e.value)).toEqual([
      'message_received', 'manual_reply_sent', 'staff_assigned', 'response_overdue', 'condition_matched',
    ])
  })

  it('内部の言葉をそのまま出さない', () => {
    for (const e of EVENT_LABELS) expect(e.label).not.toMatch(/[a-z_]{4,}/)
    expect(eventLabel('staff_assigned')).toBe('担当者が決まったとき')
  })

  it('知らないきっかけは — にする', () => {
    expect(eventLabel('nope_unknown')).toBe(NOT_AVAILABLE)
  })
})

describe('実行順', () => {
  it('優先順位が大きいほうが先。Workerの ORDER BY と同じ', () => {
    /*
      Workerは `ORDER BY d.priority DESC, d.created_at ASC`。
      並びが実行順と違うと「上のほうが先に効く」という説明が嘘になる。
    */
    const sorted = inExecutionOrder([rule({ id: 'low', priority: 50 }), rule({ id: 'high', priority: 100 })])
    expect(sorted.map((r) => r.id)).toEqual(['high', 'low'])
  })

  it('同じ優先順位なら古いほうが先', () => {
    const sorted = inExecutionOrder([
      rule({ id: 'new', priority: 10, updatedAt: '2026-08-31T10:00:00+09:00' }),
      rule({ id: 'old', priority: 10, updatedAt: '2026-08-01T10:00:00+09:00' }),
    ])
    expect(sorted.map((r) => r.id)).toEqual(['old', 'new'])
  })

  it('元の配列を壊さない', () => {
    const input = [rule({ id: 'a', priority: 1 }), rule({ id: 'b', priority: 9 })]
    inExecutionOrder(input)
    expect(input.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('複数一致の決めごとを画面で言う', () => {
    expect(MULTI_MATCH_NOTE).toContain('最初に合った1本だけ')
  })
})

describe('保護時間', () => {
  it('0は「保護しない」。未取得ではない', () => {
    expect(protectionText(0)).toBe('保護しない')
    expect(protectionText(null)).toBe(NOT_AVAILABLE)
    expect(protectionText(undefined)).toBe(NOT_AVAILABLE)
  })

  it('読みやすい単位にする', () => {
    expect(protectionText(30)).toBe('30分')
    expect(protectionText(60)).toBe('1時間')
    expect(protectionText(1440)).toBe('1日')
  })
})

describe('送る前の確かめ', () => {
  const base = { name: 'ルール', priority: 0, manualProtectionMinutes: 0 }

  it('Workerと同じ範囲で見る', () => {
    expect(validateRule(base)).toEqual([])
    expect(validateRule({ ...base, priority: PRIORITY_MAX + 1 }).map((e) => e.field)).toContain('priority')
    expect(validateRule({ ...base, priority: PRIORITY_MIN - 1 }).map((e) => e.field)).toContain('priority')
    expect(validateRule({ ...base, manualProtectionMinutes: PROTECTION_MAX + 1 }).map((e) => e.field))
      .toContain('manualProtectionMinutes')
    expect(validateRule({ ...base, manualProtectionMinutes: -1 }).map((e) => e.field))
      .toContain('manualProtectionMinutes')
  })

  it('整数でない値を通さない', () => {
    expect(validateRule({ ...base, priority: 1.5 }).map((e) => e.field)).toContain('priority')
  })

  it('名前が空なら止める', () => {
    expect(validateRule({ ...base, name: '   ' }).map((e) => e.field)).toContain('name')
  })
})

describe('失敗の言い分け', () => {
  it('版競合は status で見る。code では見分けられない', () => {
    /*
      Workerは `SUPPORT_MARK_RULE_VERSION_CONFLICT` と大文字で返す。
      `extractApiErrorCode` は英小文字のsnake_caseしか拾わないので
      `ApiError.code` は undefined になる。
    */
    const failure = failureOf({ status: 409 })
    expect(failure.kind).toBe('conflict')
    expect(failure.canReload).toBe(true)
    expect(failure.message).toContain('読み直して')
  })

  it('権限不足・入力・保存失敗を混ぜない', () => {
    expect(failureOf({ status: 403 }).kind).toBe('forbidden')
    expect(failureOf({ status: 400 }).kind).toBe('input')
    expect(failureOf({ status: 422 }).kind).toBe('input')
    expect(failureOf({ status: 500 }).kind).toBe('failure')
  })

  it('保存していないことを入力の誤りで言う', () => {
    expect(failureOf({ status: 422 }).message).toContain('保存していません')
  })

  it('内部の言葉を出さない', () => {
    for (const status of [400, 403, 404, 409, 422, 500, undefined]) {
      expect(failureOf({ status }).message).not.toMatch(/[A-Z_]{6,}/)
      expect(failureOf({ status }).message).not.toMatch(/[a-z_]{6,}/)
    }
  })
})

describe('一覧の状態', () => {
  it('取得失敗を0件と同じ顔にしない', () => {
    expect(LIST_ERROR.title).not.toBe(LIST_EMPTY.title)
    expect(LIST_ERROR.description).toContain('消えていません')
    expect(LIST_EMPTY.title).toContain('ありません')
  })
})

describe('送る本文', () => {
  const draft = {
    name: '  担当者が決まったら対応中へ  ',
    event: 'staff_assigned' as const,
    priority: '100',
    manualProtectionMinutes: '60',
    isActive: true,
  }

  it('Workerが読む6項目だけを送る', () => {
    expect(Object.keys(toRuleBody(draft)).sort())
      .toEqual(['condition', 'event', 'isActive', 'manualProtectionMinutes', 'name', 'priority'])
  })

  it('数は数で送る', () => {
    /*
      入れ物は文字列を返す。そのまま渡すと Worker の `Number.isInteger` を
      通らず400になる。
    */
    const body = toRuleBody(draft)
    expect(body.priority).toBe(100)
    expect(body.manualProtectionMinutes).toBe(60)
    expect(typeof body.priority).toBe('number')
    expect(typeof body.manualProtectionMinutes).toBe('number')
  })

  it('版を本文に混ぜない', () => {
    expect('expectedVersion' in toRuleBody(draft)).toBe(false)
  })

  it('名前の前後の空白を落とす', () => {
    expect(toRuleBody(draft).name).toBe('担当者が決まったら対応中へ')
  })
})

describe('作るか直すかの分かれ道', () => {
  const list = [{ id: 'rule-1', version: 2 }, { id: 'rule-2', version: 5 }]

  it('新規は作る側へ行く', () => {
    expect(saveCallOf('new', list)).toEqual({ kind: 'create' })
  })

  it('直すときは、そのルール自身の版を送る', () => {
    /*
      一覧の先頭の版や、画面が覚えている別の版を送ると、競合していないのに
      409になったり、古い内容で上書きできてしまう。
    */
    expect(saveCallOf('rule-2', list)).toEqual({ kind: 'update', ruleId: 'rule-2', expectedVersion: 5 })
    expect(saveCallOf('rule-1', list)).toEqual({ kind: 'update', ruleId: 'rule-1', expectedVersion: 2 })
  })

  it('一覧に無いものは送らない', () => {
    expect(saveCallOf('rule-gone', list)).toBeNull()
    expect(saveCallOf(null, list)).toBeNull()
  })
})

describe('遅い返事の照合', () => {
  const at = { accountId: 'acc-1', markId: 'mark-1', generation: 3 }

  it('3つとも一致したときだけ受け取る', () => {
    expect(isCurrentResponse({ ...at }, at)).toBe(true)
    expect(isCurrentResponse({ ...at, generation: 4 }, at)).toBe(false)
    expect(isCurrentResponse({ ...at, markId: 'mark-2' }, at)).toBe(false)
    expect(isCurrentResponse({ ...at, accountId: 'acc-2' }, at)).toBe(false)
  })

  it('世代だけで見ない', () => {
    // アカウントを切り替えた直後に、別アカウントの中身を映してしまう。
    expect(isCurrentResponse({ accountId: 'acc-2', markId: 'mark-1', generation: 3 }, at)).toBe(false)
  })
})
