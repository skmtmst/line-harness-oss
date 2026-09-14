import { describe, expect, test } from 'vitest'
import type { AccountHealthLog, LineAccount } from '@line-crm/shared'
import {
  buildHealthRows,
  buildResearchReport,
  formatOperationDate,
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

/*
 * 運用日時の表示(#738)。実装を import して見る。再実装をやめる。
 *
 * 入力の形は2種類ある。素の壁時計は JST として読み、オフセット付きISO は
 * 絶対時刻として読む。描くときは JST に固定する。端末の時計(TZ)に
 * 引きずられないことを、TZ=Asia/Tokyo と TZ=Asia/Bangkok の両方で
 * 同じ出力になることとして確かめる(両TZでこのファイルを実行する)。
 */
describe('formatOperationDate(#738)', () => {
  test('素の壁時計は書いたとおりの時刻が出る', () => {
    expect(formatOperationDate('2026-09-11 07:31')).toBe('2026/09/11 07:31')
  })

  test('T区切りでも空白区切りでも同じに読む', () => {
    expect(formatOperationDate('2026-09-02T21:04')).toBe('2026/09/02 21:04')
    expect(formatOperationDate('2026-09-02 21:04')).toBe('2026/09/02 21:04')
  })

  test('オフセット付きISOは絶対時刻として読む', () => {
    expect(formatOperationDate('2026-09-11T07:31:00+09:00')).toBe('2026/09/11 07:31')
  })

  test('Zulu時刻はJSTに直して出す', () => {
    expect(formatOperationDate('2026-09-10T22:31:00Z')).toBe('2026/09/11 07:31')
  })

  test('日をまたぐ時刻でも日付がずれない', () => {
    expect(formatOperationDate('2026-08-20 00:30')).toBe('2026/08/20 00:30')
  })

  test('日付だけなら00:00で出す', () => {
    expect(formatOperationDate('2026-08-19')).toBe('2026/08/19 00:00')
  })

  test('空なら控えの文字を出す', () => {
    expect(formatOperationDate(null)).toBe('まだありません')
    expect(formatOperationDate('')).toBe('まだありません')
  })

  test('読めない値は日時不明にする（握りつぶさない）', () => {
    expect(formatOperationDate('あとで')).toBe('日時不明')
  })
})
