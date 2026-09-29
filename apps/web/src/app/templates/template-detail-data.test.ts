import { describe, expect, it } from 'vitest'
import { isTemplateDetailData } from './template-detail-data'

/*
 * D007/D008: 詳細口は success:true でも形の違う応答を返すことがある
 * （存在しないIDへの一覧形 `{items:[]}` など）。名前・種類・本文の
 * 3つが文字列のときだけ中身として受け取り、それ以外は受け取らない。
 */
describe('テンプレート詳細の応答の形（D007/D008）', () => {
  it('一覧形・空は受け取らない', () => {
    expect(isTemplateDetailData({ items: [] })).toBe(false)
    expect(isTemplateDetailData(null)).toBe(false)
    expect(isTemplateDetailData(undefined)).toBe(false)
    expect(isTemplateDetailData('壊れた値')).toBe(false)
  })

  it('名前・種類・本文がそろっていないものは受け取らない', () => {
    expect(isTemplateDetailData({ name: '案内', messageType: 'text' })).toBe(false)
    expect(isTemplateDetailData({ name: '案内', messageType: 'text', messageContent: 42 })).toBe(false)
    expect(isTemplateDetailData({ name: '案内', messageType: 'text', messageContent: null })).toBe(false)
  })

  it('利用先が物の形でないものは受け取らない', () => {
    const base = { name: '案内', messageType: 'text', messageContent: '本文' }
    expect(isTemplateDetailData({ ...base, usedBy: '壊れた値' })).toBe(false)
    expect(isTemplateDetailData({ ...base, usedBy: { autoReplies: '壊れた値' } })).toBe(false)
  })

  it('型どおりは受け取る。利用先が無くてもよい', () => {
    const base = { name: '案内', messageType: 'text', messageContent: '本文' }
    expect(isTemplateDetailData(base)).toBe(true)
    expect(isTemplateDetailData({ ...base, usedBy: null })).toBe(true)
    expect(
      isTemplateDetailData({
        ...base,
        usedBy: {
          autoReplies: [],
          automations: [],
          scenarioSteps: [],
          reminderSteps: [],
          richMenuAreas: [],
          trackedLinks: [],
        },
      }),
    ).toBe(true)
  })
})
