/*
 * 監査 WEB198：「送れなかった」は、送れなかった通数が分からないときは「—」と、確かめる場所を言う。
 */
import { describe, expect, it } from 'vitest'
import { customerNotificationKpis } from './customer-kpis'

describe('送れなかったの数（WEB198）', () => {
  it('数が無いときは「—」と、失敗の一覧で確かめると書く', () => {
    const kpi = customerNotificationKpis({ ready: true, sentToday: 1, sentLast30d: 2, sentBreakdown: '', failed: null, quota: null })
      .find((item) => item.label === '送れなかった')!
    expect(kpi.value).toBeNull()
    expect(kpi.note).toBe('件数は失敗の一覧で確かめます')
  })
})

describe('作れたあと公開だけ失敗（WEB199）', () => {
  it('作れた定義を失敗の結果に入れて返す（やり直しで同じキーを作り直さない）', async () => {
    const { saveCustomerNotification } = await import('./screen')
    const definition = { id: 'def-1', version: 1, lineAccountId: 'acc', sourceEventType: 'ec.order', draft: {} }
    const outcome = await saveCustomerNotification({
      api: {
        createDefinition: async () => ({ success: true, data: definition }),
        publishDefinition: async () => { throw new Error('network') },
        updateDraft: async () => { throw new Error('unused') },
        stopDefinition: async () => { throw new Error('unused') },
      } as never,
      accountId: 'acc',
      setting: { eventType: 'ec.order', label: '注文', title: '注文ありがとう', isEnabled: false, category: 'order', introText: '', outroText: '', buttonLabel: '', buttonUrl: '', imageUrl: '', fixedFields: [] } as never,
      definition: null,
      enabled: true,
      guard: { generation: 1, currentGeneration: () => 1, forAccountId: 'acc', currentAccountId: () => 'acc', sentFingerprint: 'x', currentFingerprint: () => 'x' },
    })
    expect(outcome.kind).toBe('failed')
    expect(outcome.kind === 'failed' ? outcome.createdDefinition?.id : null).toBe('def-1')
  })
})
