import { describe, expect, test } from 'vitest'
import type { AccountHealthLog, LineAccount } from '@line-crm/shared'
import {
  buildHealthRows,
  buildResearchReport,
  HEALTH_CRITERIA,
  monthlyQuotaStatus,
  overallSeverity,
} from './operation-status'

const account = { id: 'account-1', name: '然-NEN- 公式' } as LineAccount
const log = {
  id: 'log-1',
  lineAccountId: account.id,
  errorCode: 403,
  errorCount: 1,
  checkPeriod: '1h',
  riskLevel: 'danger',
  createdAt: '2026-08-18T03:00:00.000Z',
} satisfies AccountHealthLog

describe('operation status', () => {
  test.each([
    { limit: 1000, used: 850, severity: 'normal', remaining: 150 },
    { limit: 1000, used: 851, severity: 'warning', remaining: 149 },
    { limit: 1000, used: 1000, severity: 'danger', remaining: 0 },
    { limit: 1000, used: 1200, severity: 'danger', remaining: 0 },
    { limit: null, used: null, severity: 'normal', remaining: null },
  ])('月間配信残数を $severity と判定する', ({ limit, used, severity, remaining }) => {
    expect(monthlyQuotaStatus(limit, used)).toMatchObject({ severity, remaining })
  })

  test('最新の実データから異常状態を組み立てる', () => {
    const rows = buildHealthRows([account], { [account.id]: [log] }, { [account.id]: 'danger' })
    expect(rows[0]).toMatchObject({ accountName: '然-NEN- 公式', severity: 'danger', errorCode: 403 })
    expect(overallSeverity(rows)).toBe('danger')
  })

  test('ログが無いアカウントを正常と決めつけない', () => {
    const rows = buildHealthRows([account], {}, {})
    expect(rows[0].severity).toBe('unknown')
    expect(overallSeverity(rows)).toBe('unknown')
  })

  test('調査レポートは秘密値を受け取らず、基準を含む', () => {
    const rows = buildHealthRows([account], { [account.id]: [log] }, { [account.id]: 'danger' })
    const report = buildResearchReport({
      generatedAt: '2026-08-18T04:00:00.000Z',
      overall: 'danger',
      rows,
      quotaLimit: 5000,
      quotaUsed: 12,
    })
    expect(report).toContain('運用状態 調査レポート')
    expect(report).toContain('異常判定基準')
    expect(report).toContain('4,988')
    expect(report).not.toContain('channelAccessToken')
  })

  test('異常判定基準を3段階で固定する', () => {
    expect(HEALTH_CRITERIA.map((item) => item.severity)).toEqual(['danger', 'warning', 'normal'])
  })
})
