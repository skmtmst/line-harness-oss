import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { formatDate, formatDateTime, planStatusChip, tenantUseStatusChip } from './ops-ui'

/**
 * 監査 R153（利用状態と請求状態を別の札で出す）と R160（運営画面の日時は
 * 日本時間固定）を守る試験。
 */

const chipText = (node: React.ReactNode): string => String((node as ReactElement<{ children: React.ReactNode }>).props.children)

describe('契約先の状態の札（R153）', () => {
  it('利用状態と請求状態は別の札・別の言葉で出す', () => {
    // 請求が解約済みでも、利用状態の札は「契約中」に化けない
    expect(chipText(tenantUseStatusChip('active'))).toBe('利用中')
    expect(chipText(planStatusChip('canceled'))).toBe('請求解約')
  })

  it('active＋canceled / active＋exempt / active＋active を区別できる', () => {
    expect(chipText(planStatusChip('active'))).toBe('契約中')
    expect(chipText(planStatusChip('exempt'))).toBe('課金対象外')
    expect(chipText(planStatusChip('trialing'))).toBe('トライアル中')
    expect(chipText(planStatusChip('past_due'))).toBe('決済失敗')
    expect(chipText(tenantUseStatusChip('suspended'))).toBe('利用停止')
    expect(chipText(tenantUseStatusChip('archived'))).toBe('解約済み')
  })
})

describe('運営画面の日時は日本時間固定（R160）', () => {
  it('UTC の同じ瞬間を、端末のタイムゾーンに関係なく日本時間で表示する', () => {
    // 2026-09-27T12:36:00Z は日本時間の 21:36。実行環境が UTC でも JST でも同じ結果。
    expect(formatDateTime('2026-09-27T12:36:00.000Z')).toBe('2026-09-27 21:36')
    expect(formatDate('2026-09-27T12:36:00.000Z')).toBe('2026-09-27')
    // 日またぎも日本時間で切る
    expect(formatDateTime('2026-09-27T15:30:00.000Z')).toBe('2026-09-28 00:30')
  })

  it('空と読めない値の扱いは今までどおり', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime(undefined)).toBe('—')
    expect(formatDateTime('not-a-date')).toBe('not-a-date')
  })
})
