import { describe, expect, it } from 'vitest'
import type { BroadcastPreflight } from '@/lib/api'
import { broadcastPreflightSummary } from './broadcast-preflight-summary'

const input = {
  preflight: null,
  targetMode: 'all', tags: [], tagId: '', scenarios: [], scenariosStatus: 'idle',
  audience: null, excludeTagId: '', sendMode: 'now', scheduledDate: '', scheduledTime: '',
  spreadMinutes: '0', testPassed: false, previewConfirmed: false,
} satisfies Parameters<typeof broadcastPreflightSummary>[0]
const result = (extra: Partial<BroadcastPreflight> = {}): BroadcastPreflight => ({ audienceCount: 10, hiddenExcluded: 0, warnings: [], ...extra })
const exclusions = { blocked: 0, hidden: 0, missingDestination: 0, duplicate: 0, paused: null, total: 0 }

describe('配信の事前確認を表示する値', () => {
  it('未取得は未取得のまま、確認済みの0人・除外なしと区別する', () => {
    expect(broadcastPreflightSummary(input)).toMatchObject({ audienceCount: null, audienceDisplayCount: null, exclusionNote: null, quotaNote: null, evaluatedAtLabel: null, unconfirmedCount: null })
    expect(broadcastPreflightSummary({ ...input, preflight: result({ audienceCount: 0, exclusions }) })).toMatchObject({ audienceCount: 0, audienceDisplayCount: 0, exclusionNote: '除外なし', unconfirmedCount: 2 })
  })

  it('シナリオ候補が未取得なら削除済みと断定せず、取得後は名前か削除済みを表示する', () => {
    const scenario = { ...input, targetMode: 'scenario' as const, audience: { operator: 'AND' as const, rules: [{ type: 'scenario_subscribed' as const, value: 'scenario-a' }] } }
    expect(broadcastPreflightSummary(scenario).confirmAudienceLabel).toBe('指定のシナリオを購読中')
    expect(broadcastPreflightSummary({ ...scenario, scenariosStatus: 'ready', scenarios: [{ id: 'scenario-a', name: 'ご案内' }] }).confirmAudienceLabel).toBe('シナリオ：ご案内')
    expect(broadcastPreflightSummary({ ...scenario, scenariosStatus: 'ready' }).confirmAudienceLabel).toBe('シナリオ（削除済み）')
  })

  it('除外タグと実測の除外内訳を両方示し、内訳のない応答でも人数を捏造しない', () => {
    const excluded = { ...input, excludeTagId: 'exclude', tags: [{ id: 'exclude', name: '配信不要' }] }
    expect(broadcastPreflightSummary(excluded).exclusionNote).toBe('タグ「配信不要」を除く ・ 除外人数は未取得')
    expect(broadcastPreflightSummary({ ...excluded, preflight: result({ exclusions: { ...exclusions, blocked: 2, duplicate: 3, total: 5 } }) }).exclusionNote).toBe('タグ「配信不要」を除く ・ ブロック 2人・重複 3人を除外')
    expect(broadcastPreflightSummary({ ...input, preflight: result({ warnings: [{ level: 'info', message: 'ブロック中の友だちを除いています' }] }) }).exclusionNote).toBe('ブロック中の友だちを除いています')
  })

  it.each([
    ['available', false, '残り 100 / 1,000通（この配信で 10通を使用）'],
    ['insufficient', true, '不足しています（残り 100 / 1,000通）'],
    ['unavailable', false, '確認できませんでした'],
  ] as const)('送信枠 %s は他の状態に置き換えない', (state, insufficient, note) => {
    const summary = broadcastPreflightSummary({ ...input, preflight: result({ quota: { state, monthlyUsed: 900, monthlyLimit: 1000, remaining: 100, planned: 10, reason: null } }) })
    expect(summary.quotaInsufficient).toBe(insufficient)
    expect(summary.quotaNote).toBe(note)
  })

  it('予約日時・分散時間を示し、警告と未確認の試送信・見本だけを残件数へ数える', () => {
    const summary = broadcastPreflightSummary({ ...input, sendMode: 'scheduled', scheduledDate: '2030-10-05', scheduledTime: '10:00', spreadMinutes: '30', testPassed: true, preflight: result({ warnings: [{ level: 'warning', message: '確認項目' }, { level: 'info', message: '案内' }] }) })
    expect(summary.scheduledLabel).toBe('2030/10/05 10:00（30分かけて配信）')
    expect(summary.sendWhenLabel).toBe(summary.scheduledLabel)
    expect(summary.unconfirmedCount).toBe(2)
    expect(broadcastPreflightSummary({ ...input, sendMode: 'optimal' }).sendWhenLabel).toBeNull()
  })
})
