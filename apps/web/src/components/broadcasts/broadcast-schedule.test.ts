import { describe, expect, it } from 'vitest'
import type { ApiBroadcast } from '@/lib/api'
import { broadcastSpreadMinutes, readBroadcastSchedule } from './broadcast-schedule'
import { buildBroadcastDraft } from './broadcast-draft-actions'

function draft(draftPayload: Record<string, unknown>, scheduledAt: string | null = null) {
  return { draftPayload, scheduledAt } as ApiBroadcast
}
const context = {
  afterActionVersionId: '', bubbles: [{ id: 'b', type: 'text' as const, content: { text: 'お知らせ' } }],
  currentStep: 'schedule' as const, folderId: '', internalMemo: '', measureOpens: true, messageButtons: [],
  selectedAccountId: 'acc', targetPayload: () => ({ targetType: 'tag' as const, targetTagId: 'tag', segmentConditions: undefined }),
  title: '配信', trackLinks: true,
}

describe('送る時間の下書き', () => {
  it('旧下書きの日時なし・分散0は選び直し、日時と分散は維持する', () => {
    expect(readBroadcastSchedule(draft({})).sendChoice).toBe('unselected')
    expect(readBroadcastSchedule(draft({ stealthSpreadMinutes: 0 })).sendChoice).toBe('unselected')
    expect(readBroadcastSchedule(draft({}, '2099-01-01T01:00:00Z')).sendChoice).toBe('scheduled')
    expect(readBroadcastSchedule(draft({ stealthSpreadMinutes: 45 }))).toMatchObject({ sendChoice: 'spread', spreadStart: 'now', spreadMinutes: '45' })
    expect(readBroadcastSchedule(draft({ stealthSpreadMinutes: 45 }, '2099-01-01T01:00:00Z')).spreadStart).toBe('scheduled')
  })
  it('古い今すぐの印より予約の現在値を優先し、印の古い日付は戻さない', () => {
    const row = { ...draft({ draftSendChoice: 'now', draftScheduledDate: '2020-01-01', draftScheduledTime: '01:00' }, '2099-01-02T01:00:00Z'), status: 'scheduled' as const, stealthSpreadMinutes: 0 }
    expect(readBroadcastSchedule(row)).toMatchObject({ sendChoice: 'scheduled', scheduledDate: null, scheduledTime: null })
  })
  it('古い印と分数より本物の分数45を優先する', () => {
    const row = { ...draft({ draftSendChoice: 'scheduled', stealthSpreadMinutes: 0, draftSpreadMinutes: '30' }, '2099-01-02T01:00:00Z'), stealthSpreadMinutes: 45 }
    expect(readBroadcastSchedule(row)).toMatchObject({ sendChoice: 'spread', spreadStart: 'scheduled', spreadMinutes: '45' })
  })
  it.each(['now', 'unselected', 'optimal'] as const)('%sは画面用の印から戻す', sendChoice => {
    const body = buildBroadcastDraft({ ...context, sendChoice, spreadMinutes: '0' }, null, true)
    expect(readBroadcastSchedule(draft(body)).sendChoice).toBe(sendChoice)
    expect(body.stealthSpreadMinutes).toBe(0)
  })
  it.each(['', '0', '721', '1.5'])('分散の書きかけ「%s」は即時配信に化けず、配送値に不正な分数を渡さない', spreadMinutes => {
    const body = buildBroadcastDraft({ ...context, sendChoice: 'spread', spreadStartMode: 'scheduled', spreadMinutes, scheduledDate: '', scheduledTime: '' }, null, true)
    expect(body.stealthSpreadMinutes).toBe(0)
    expect(readBroadcastSchedule(draft(body))).toMatchObject({ sendChoice: 'spread', spreadStart: 'scheduled', spreadMinutes, scheduledDate: '', scheduledTime: '' })
  })
  it('開始日時の書きかけは分数45があってもすぐへ戻さない', () => {
    const row = { ...draft({ draftSendChoice: 'spread', draftSpreadStart: 'scheduled', draftScheduledDate: '', draftScheduledTime: '', draftSpreadMinutes: '45' }), stealthSpreadMinutes: 45 }
    expect(readBroadcastSchedule(row)).toMatchObject({ sendChoice: 'spread', spreadStart: 'scheduled', spreadMinutes: '45', scheduledDate: '', scheduledTime: '' })
  })
  it('日時の書きかけを戻す', () => {
    const body = buildBroadcastDraft({ ...context, sendChoice: 'scheduled', spreadMinutes: '0', scheduledDate: '2099-01-02', scheduledTime: '' }, null, true)
    expect(readBroadcastSchedule(draft(body))).toMatchObject({ sendChoice: 'scheduled', scheduledDate: '2099-01-02', scheduledTime: '' })
  })
  it('分散の開始を確定後にした選択と分数を戻す', () => {
    const body = buildBroadcastDraft({ ...context, sendChoice: 'spread', spreadStartMode: 'now', spreadMinutes: '45' }, null, true)
    expect(readBroadcastSchedule(draft(body))).toMatchObject({ sendChoice: 'spread', spreadStart: 'now', spreadMinutes: '45' })
    expect(body.stealthSpreadMinutes).toBe(45)
  })
  it.each([['1', 1], ['720', 720], ['30', 30], ['', 0], ['x', 0]])('配送の分数 %s → %s', (raw, value) => {
    expect(broadcastSpreadMinutes(String(raw))).toBe(value)
  })
})
