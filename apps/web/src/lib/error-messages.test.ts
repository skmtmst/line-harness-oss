import { describe, expect, it } from 'vitest'

import { ApiError } from './api'
import { resolveFailureCopy, type ErrorMessageEntry } from './error-messages'

/**
 * 失敗の文面を対応表から引く（要件 v6-34 §9）。
 *
 * 守りたいのは 3 点。
 *   1. 表にあるコードは表の文面と次の行動を出す
 *   2. 表に無いコードは汎用文面＋追跡番号。**原文を出さない**
 *   3. 追跡番号が無い応答では、番号の言い回しを崩さない
 */

function table(rows: Array<Partial<ErrorMessageEntry> & { code: string }>): Map<string, ErrorMessageEntry> {
  return new Map(
    rows.map((row) => [
      row.code,
      {
        message: '',
        nextAction: { kind: 'none' as const, target: null },
        version: 1,
        ...row,
      },
    ]),
  )
}

describe('resolveFailureCopy', () => {
  it('表にあるコードは表の文面と次の行動を返す', async () => {
    const t = table([
      {
        code: 'FEATURE_DISABLED',
        message: 'この機能は機能設定でオフになっています',
        nextAction: { kind: 'navigate', target: '/settings/features' },
      },
    ])
    const copy = resolveFailureCopy(
      new ApiError(403, '機能が無効です', 'FEATURE_DISABLED'),
      t,
    )
    expect(copy.message).toBe('この機能は機能設定でオフになっています')
    expect(copy.action).toEqual({ kind: 'navigate', href: '/settings/features', label: null })
  })

  it('code を持たない現行 route の error 文字列でも引ける', async () => {
    const t = table([
      {
        code: 'No test recipients configured',
        message: 'テスト受信者が登録されていません',
        nextAction: { kind: 'navigate', target: '/accounts' },
      },
    ])
    const copy = resolveFailureCopy(
      new ApiError(400, 'No test recipients configured'),
      t,
    )
    expect(copy.message).toBe('テスト受信者が登録されていません')
  })

  it('「LINE API error: 401」のような前方一致を拾う', async () => {
    const t = table([
      {
        code: 'LINE API error: 401',
        message: 'LINEのアクセストークンが無効です',
        nextAction: { kind: 'navigate', target: '/accounts' },
      },
    ])
    const copy = resolveFailureCopy(
      new ApiError(400, 'LINE API error: 401: token expired'),
      t,
    )
    expect(copy.message).toBe('LINEのアクセストークンが無効です')
  })

  it('表に無い失敗は汎用文面と追跡番号に落とし、原文を出さない', async () => {
    const copy = resolveFailureCopy(
      new ApiError(500, 'SQLITE_CONSTRAINT: FOREIGN KEY failed', undefined, undefined, 'inc-123'),
      table([]),
    )
    expect(copy.message).toBe('処理できませんでした（追跡番号 inc-123）')
    expect(copy.message).not.toContain('SQLITE')
    expect(copy.action.kind).toBe('contact_admin')
    expect(copy.trackingId).toBe('inc-123')
  })

  it('表の文面の追跡番号の差し込みを埋める', async () => {
    const t = table([
      {
        code: 'Internal Server Error',
        message: '処理できませんでした（追跡番号 {incidentId}）',
        nextAction: { kind: 'retry', target: null },
      },
    ])
    const copy = resolveFailureCopy(
      new ApiError(500, 'API error: 500', undefined, undefined, 'inc-9'),
      t,
    )
    expect(copy.message).toBe('処理できませんでした（追跡番号 inc-9）')
    expect(copy.action.label).toBe('もう一度試す')
  })

  it('追跡番号が無い応答では、番号の言い回しを残さない', async () => {
    const t = table([
      {
        code: 'Internal Server Error',
        message: '処理できませんでした（追跡番号 {incidentId}）',
        nextAction: { kind: 'retry', target: null },
      },
    ])
    const copy = resolveFailureCopy(new ApiError(500, 'API error: 500'), t)
    expect(copy.message).toBe('処理できませんでした')
    expect(copy.message).not.toContain('追跡番号')
    expect(copy.message).not.toContain('{')
  })

  it('ApiError でないものも汎用文面に落とす', async () => {
    const copy = resolveFailureCopy(new Error('boom'), table([]))
    expect(copy.message).toBe('処理できませんでした')
  })
})
