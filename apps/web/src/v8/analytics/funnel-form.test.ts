import { describe, expect, it } from 'vitest'
import { choiceOf, funnelMatchFor, funnelStepPrimaryKey, kindNeedsValue } from './funnel-form'

/*
 * ★V8「ファネルを作る」（VDPz5）：何をしたらの選ぶ欄は種類と相手を1つにまとめる。
 * 保存の形（match）は今の画面と同じであること・一覧に無い相手は「ほかの条件」へ回ることを見張る。
 */
const targets = [
  { kind: 'conversion' as const, id: 'cp-1', name: '体験申込フォームの送信' },
  { kind: 'tag' as const, id: 'tag-1', name: 'VIP' },
]

describe('ファネルを作る（V8）', () => {
  it('種類だけの段は種類、相手のある段は 種類:ID を選ぶ', () => {
    expect(choiceOf({ kind: 'friend_add', value: '', other: false }, targets)).toBe('friend_add')
    expect(choiceOf({ kind: 'conversion', value: 'cp-1', other: false }, targets)).toBe('conversion:cp-1')
    expect(choiceOf({ kind: 'tag', value: 'tag-1', other: false }, targets)).toBe('tag:tag-1')
  })

  it('相手がまだ無い段は「選ぶ」、一覧に無いIDは「ほかの条件」へ回す（IDを捨てない）', () => {
    expect(choiceOf({ kind: 'conversion', value: '', other: false }, targets)).toBe('conversion:')
    expect(choiceOf({ kind: 'tag', value: 'tag-unknown', other: false }, targets)).toBe('__other__')
    expect(choiceOf({ kind: 'site_event', value: 'thanks', other: false }, targets)).toBe('__other__')
    expect(choiceOf({ kind: 'friend_add', value: '', other: true }, targets)).toBe('__other__')
  })

  it('保存の match は今の画面と同じ形', () => {
    expect(funnelMatchFor('friend_add', '')).toEqual({})
    expect(funnelMatchFor('conversion', 'cp-1')).toEqual({ conversionPointId: 'cp-1' })
    expect(funnelMatchFor('site_event', 'thanks')).toEqual({ eventType: 'page_view', pathGroup: 'thanks' })
    expect(funnelMatchFor('booking', '')).toEqual({ status: 'confirmed' })
    expect(funnelStepPrimaryKey('automation')).toBe('automationId')
    expect(kindNeedsValue('purchase')).toBe(false)
    expect(kindNeedsValue('form')).toBe(true)
  })
})
