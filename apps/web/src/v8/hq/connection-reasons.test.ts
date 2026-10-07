import { describe, expect, test } from 'vitest'
import type { AccountWithStats } from '@/contexts/account-context'
import { FALLBACK_REASON, connectionReasonLine, connectionReasons, lineHandle } from './connection-reasons'
import { accountHandle } from './account-dialogs'

const base: AccountWithStats = {
  id: 'acc-1',
  channelId: '2000000001',
  name: '然 -NEN- 渋谷店',
  isActive: true,
  country: null,
  role: null,
  displayOrder: 0,
}

describe('LINE ID の表示', () => {
  test('LINE から @ 付きで来ても @ は1つだけ', () => {
    expect(lineHandle({ basicId: '@273ytrca', channelId: '1' })).toBe('@273ytrca')
    expect(accountHandle({ ...base, basicId: '@273ytrca' })).toBe('@273ytrca')
  })

  test('@ が無ければ1つ付ける・無ければチャネル ID', () => {
    expect(lineHandle({ basicId: 'nen-shibuya', channelId: '1' })).toBe('@nen-shibuya')
    expect(lineHandle({ basicId: null, channelId: '2000000001' })).toBe('@2000000001')
  })
})

describe('要確認の理由', () => {
  test('Webhook の URL が違うときは、登録とこの環境の URL を出す', () => {
    const account: AccountWithStats = {
      ...base,
      connection: {
        status: 'warn',
        checkedAt: '2026-10-07T10:00:00+09:00',
        issues: [{
          kind: 'webhook_endpoint',
          result: 'mismatched',
          expectedUrl: 'https://stg-api.musubo.jp/webhook',
          registeredUrl: 'https://api.musubo.jp/webhook',
          webhookActive: true,
          httpStatus: 200,
        }],
      },
    }
    const line = connectionReasonLine(account)
    expect(line.text).toBe('Webhook の URL がこの環境と違います（登録：https://api.musubo.jp/webhook／この環境：https://stg-api.musubo.jp/webhook）')
    expect(line.title).toContain('https://api.musubo.jp/webhook')
  })

  test('トークンが使えない・期限切れ・テスト失敗を、それぞれの言葉にする', () => {
    const account: AccountWithStats = {
      ...base,
      connection: {
        status: 'warn',
        checkedAt: null,
        tokenExpired: true,
        issues: [
          { kind: 'bot_info', result: 'failed', expectedUrl: null, registeredUrl: null, webhookActive: null, httpStatus: 401 },
          { kind: 'webhook_test', result: 'failed', expectedUrl: 'https://stg-api.musubo.jp/webhook', registeredUrl: null, webhookActive: null, httpStatus: 500 },
        ],
      },
    }
    expect(connectionReasons(account).map((reason) => reason.short)).toEqual([
      'LINE のトークンの期限が切れています',
      'LINE のトークンが使えません',
      'Webhook の接続テストが通りません',
    ])
    expect(connectionReasonLine(account).text).toBe('LINE のトークンの期限が切れています（ほか 2 件）')
  })

  test('Webhook が未登録・利用オフ', () => {
    const issue = { kind: 'webhook_endpoint' as const, expectedUrl: 'https://stg-api.musubo.jp/webhook', httpStatus: 200 }
    expect(connectionReasons({ ...base, connection: { status: 'warn', checkedAt: null, issues: [{ ...issue, result: 'unconfigured', registeredUrl: null, webhookActive: false }] } })[0].short)
      .toBe('LINE に Webhook の URL が登録されていません')
    expect(connectionReasons({ ...base, connection: { status: 'warn', checkedAt: null, issues: [{ ...issue, result: 'mismatched', registeredUrl: 'https://stg-api.musubo.jp/webhook', webhookActive: false }] } })[0].short)
      .toBe('LINE で Webhook の利用がオフです')
  })

  test('理由が届かない（古い worker）ときは、今までの案内に戻す', () => {
    expect(connectionReasonLine({ ...base, connection: { status: 'warn', checkedAt: null } }).text).toBe(FALLBACK_REASON)
  })
})
