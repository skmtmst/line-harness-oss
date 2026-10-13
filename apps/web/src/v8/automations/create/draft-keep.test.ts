/*
 * 下書きを仕上げる（J1VA8）：見本から作った下書きの「担当へ知らせる」を、読んで保存し直しても
 * 消さない（知らせのルールと文面をそのまま戻す）。この画面では選び直せないため。
 */
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import { actionDraftToPayload, draftDetailToForm } from './create'

const detail = {
  id: 'draft-1',
  draftVersionId: 'v1',
  name: '見本：「予約」と送られたら担当へ（下書き）',
  description: null,
  eventType: 'message_received' as const,
  triggerConfig: { keyword: '予約' },
  conditions: {},
  actions: [
    { id: 'a1', type: 'add_tag' as const, params: { tagId: 'tag-1' }, onFailure: 'stop' as const },
    {
      id: 'a2',
      type: 'notify_staff' as unknown as 'add_tag',
      params: { notificationRuleId: 'rule-1', message: '河野・坂本に LINE で' },
      onFailure: 'stop' as const,
    },
  ],
  commonActionRefs: [],
  commonActionVersions: {},
}

describe('下書きを仕上げる：担当へ知らせるを保つ', () => {
  it('読んだ知らせのルールと文面を、そのまま保存の形へ戻す', () => {
    const form = draftDetailToForm(detail)
    const payload = form.actions.map((row, index) => actionDraftToPayload(row, index))
    expect(payload[1]).toEqual({
      id: 'a2',
      type: 'notify_staff',
      params: { notificationRuleId: 'rule-1', message: '河野・坂本に LINE で' },
      onFailure: 'stop',
    })
    expect(payload[0]).toMatchObject({ type: 'add_tag', params: { tagId: 'tag-1' } })
  })

  it('既存の処理を消して足しても、残った処理のIDと新しい処理のIDが重ならない', () => {
    const form = draftDetailToForm({ ...detail, actions: [{ ...detail.actions[0], id: 'step-2' }] })
    const rows = [form.actions[0], { ...form.actions[0], key: form.actions[0].key + 100, sourceId: undefined }]
    const payload = rows.map(actionDraftToPayload)
    expect(payload.map(row => row.id)).toEqual(['step-2', 'step-3'])
    expect(payload[0].params).toEqual({ tagId: 'tag-1' })
  })
})
