import { describe, expect, it } from 'vitest'
import type { CommonActionResources, CommonActionStep } from '@/lib/api'
import { stepSummary } from './common-action-new'

const resources = {
  tags: [{ id: 't1', name: '購入済み' }], scenarios: [], templates: [{ id: 'm1', name: '購入のお礼' }], webhooks: [], richMenus: [], commonActions: [],
} as unknown as CommonActionResources
const step = (type: CommonActionStep['type'], params: Record<string, unknown>) => ({ id: 's', type, params, onFailure: 'stop' }) as CommonActionStep

describe('共通アクションを作る（j2hfkS）の処理の行の2行目', () => {
  it('選んだものの名前、まだなら「〇〇を選ぶ」、待つは日・時間・分', () => {
    expect(stepSummary(step('add_tag', { tagId: 't1' }), resources)).toBe('タグ「購入済み」')
    expect(stepSummary(step('add_tag', {}), resources)).toBe('タグを選ぶ')
    expect(stepSummary(step('send_message', { templateId: 'm1' }), resources)).toBe('テンプレート「購入のお礼」')
    expect(stepSummary(step('wait', { durationMinutes: 1440 }), resources)).toBe('1 日')
    expect(stepSummary(step('wait', { durationMinutes: 90 }), resources)).toBe('90 分')
  })
})
