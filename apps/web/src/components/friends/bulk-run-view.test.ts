import { describe, expect, it } from 'vitest'
import type { FriendBulkPreview, FriendBulkRunDetail } from '@line-crm/shared'
import {
  ITEM_GROUPS, NOT_AVAILABLE, OPERATIONS, blockedReason, canExecute, canRetry, canRunBulk,
  canUndo, countText, failureOf, isRunComplete, itemStatusLabel, operationLabel,
} from './bulk-run-view'

const preview = (over: Partial<FriendBulkPreview> = {}): FriendBulkPreview => ({
  selectedCount: 4, targetCount: 3, excludedCount: 1,
  accountBreakdown: [{ lineAccountId: 'visual-qa-account', count: 3 }],
  exclusions: [{ reason: 'LINEの友だちではないため対象外', count: 1 }],
  sample: [], reversible: true, ...over,
})

const detail = (over: Partial<FriendBulkRunDetail> = {}): FriendBulkRunDetail => ({
  id: 'r1', status: 'partial', selection: { kind: 'explicit', friendIds: [] },
  operation: { kind: 'add_tag', tagId: 't1' }, targetCount: 3, excludedCount: 1,
  successCount: 2, skippedCount: 0, temporaryFailureCount: 1, permanentFailureCount: 0,
  reversible: true, scheduledAt: null, createdAt: '', startedAt: null, completedAt: null,
  updatedAt: '', items: [], page: 1, limit: 50, total: 3, ...over,
})

describe('権限', () => {
  it('一括操作はオーナーと管理者だけ', () => {
    // 個別操作の権限を越えるため、スタッフには出さない。
    expect(canRunBulk('owner')).toBe(true)
    expect(canRunBulk('admin')).toBe(true)
    for (const r of ['staff', '', null, undefined]) expect(canRunBulk(r)).toBe(false)
  })
})

describe('人数の見え方', () => {
  it('未取得は — 、実値0は 0', () => {
    expect(countText(0, '人')).toBe('0人')
    expect(countText(null, '人')).toBe(NOT_AVAILABLE)
    expect(countText(undefined, '人')).toBe(NOT_AVAILABLE)
  })
  it('桁を区切る', () => { expect(countText(1284, '人')).toBe('1,284人') })
})

describe('実行してよいか', () => {
  it('未取得のときは実行させない', () => {
    // 何人に何が起きるか分からないまま走らせることになる。
    expect(canExecute({ preview: null, busy: false, irreversibleConfirmed: false, reversible: true })).toBe(false)
    expect(blockedReason({ preview: null, reversible: true, irreversibleConfirmed: false })).toContain('数えられていません')
  })

  it('対象0人では実行させない', () => {
    expect(canExecute({ preview: preview({ targetCount: 0 }), busy: false, irreversibleConfirmed: false, reversible: true })).toBe(false)
    expect(blockedReason({ preview: preview({ targetCount: 0 }), reversible: true, irreversibleConfirmed: false })).toContain('0人')
  })

  it('取り消せない操作は追加の確認を通してからだけ', () => {
    const base = { preview: preview(), busy: false }
    expect(canExecute({ ...base, reversible: false, irreversibleConfirmed: false })).toBe(false)
    expect(canExecute({ ...base, reversible: false, irreversibleConfirmed: true })).toBe(true)
    expect(blockedReason({ preview: preview(), reversible: false, irreversibleConfirmed: false })).toContain('取り消せない')
  })

  it('送信中は押させない', () => {
    expect(canExecute({ preview: preview(), busy: true, irreversibleConfirmed: true, reversible: true })).toBe(false)
  })
})

describe('結果の呼び分け', () => {
  it('成功・見送り・一時失敗・恒久失敗を別の言葉にする', () => {
    const labels = ITEM_GROUPS.map((g) => g.label)
    expect(new Set(labels).size).toBe(4)
    expect(itemStatusLabel('temporary_failure')).not.toBe(itemStatusLabel('permanent_failure'))
    expect(itemStatusLabel('success')).not.toBe(itemStatusLabel('skipped'))
  })

  it('内部の言葉をそのまま出さない', () => {
    for (const s of ['success','skipped','temporary_failure','permanent_failure','queued','running','waiting'] as const) {
      expect(itemStatusLabel(s)).not.toMatch(/[a-z_]{4,}/)
    }
    for (const o of OPERATIONS) expect(o.label).not.toMatch(/[a-z_]{4,}/)
    expect(operationLabel('nope_unknown')).toBe(NOT_AVAILABLE)
  })
})

describe('やり直しと取り消し', () => {
  it('途中の件数を確定結果として扱わない', () => {
    for (const status of ['preparing', 'queued', 'running', 'waiting'] as const) {
      expect(isRunComplete(status)).toBe(false)
      expect(canRetry(detail({ status }))).toBe(false)
      expect(canUndo(detail({ status }))).toBe(false)
    }
    for (const status of ['success', 'partial', 'failed', 'cancelled'] as const) {
      expect(isRunComplete(status)).toBe(true)
    }
  })

  it('やり直しは失敗した対象がいるときだけ', () => {
    expect(canRetry(detail())).toBe(true)
    expect(canRetry(detail({ temporaryFailureCount: 0 }))).toBe(false)
    expect(canRetry(null)).toBe(false)
  })

  it('取り消しは取り消せる操作で、終わった人がいるときだけ', () => {
    expect(canUndo(detail())).toBe(true)
    expect(canUndo(detail({ reversible: false }))).toBe(false)
    expect(canUndo(detail({ successCount: 0 }))).toBe(false)
  })
})

describe('失敗の言い換え', () => {
  it('409を一般の失敗と混ぜない', () => {
    /*
      同じ鍵で中身が違う実行を送ったときに出る。「もう一度押す」ではなく
      「読み直す」が正しい次の行動になる。
    */
    const f = failureOf({ status: 409 })
    expect(f.kind).toBe('conflict')
    expect(f.canReload).toBe(true)
    expect(f.message).toContain('読み直して')
  })

  it('再試行と取り消しの409を冪等性競合と決めつけない', () => {
    expect(failureOf({ status: 409, action: 'retry' }).message).toContain('やり直す対象')
    expect(failureOf({ status: 409, action: 'undo' }).message).toContain('取り消せる対象')
  })

  it('結果の読込失敗を実行失敗と扱わず、結果だけを読み直せる', () => {
    const failure = failureOf({ status: 500, action: 'detail' })
    expect(failure.message).toContain('結果だけを読み直して')
    expect(failure.message).not.toContain('実行できませんでした')
    expect(failure.canReload).toBe(true)
  })

  it('権限不足・入力・実行失敗を分ける', () => {
    expect(failureOf({ status: 403 }).kind).toBe('forbidden')
    expect(failureOf({ status: 400 }).kind).toBe('input')
    expect(failureOf({ status: 500 }).kind).toBe('failure')
  })

  it('実行していないことを入力の誤りで言う', () => {
    expect(failureOf({ status: 422 }).message).toContain('実行していません')
  })

  it('生のAPIエラーや内部コードを出さない', () => {
    for (const s of [400, 403, 404, 409, 422, 500, undefined]) {
      const m = failureOf({ status: s }).message
      expect(m).not.toMatch(/[A-Z_]{6,}/)
      expect(m).not.toContain('API error')
    }
  })
})
