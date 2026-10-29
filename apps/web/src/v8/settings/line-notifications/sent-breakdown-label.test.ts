/*
 * 「今日 送った」の内訳の文は、お客さま向けの名前で出す。
 * `ec.order.confirmed` のような内部のイベントキーをそのまま出さない。
 */
import { describe, expect, it } from 'vitest'

import { buildSentBreakdown } from './screen'
import type { EcNotificationSetting } from '@/lib/api'

const setting = (eventType: string, label: string): EcNotificationSetting => ({
  eventType,
  label,
  isEnabled: true,
  title: null,
  introText: '',
  outroText: '',
  category: 'order',
  buttonLabel: '',
  buttonUrl: '',
  imageUrl: '',
  displayOrder: 0,
  fixedFields: [],
  fixedPreview: '',
  updatedAt: '2026-10-29T00:00:00.000Z',
})

const settings = [
  setting('ec.order.confirmed', '注文受付'),
  setting('ec.order.shipped', '発送完了'),
]

describe('「今日 送った」の内訳の文', () => {
  it('設定の label の名前で件数を出す', () => {
    const text = buildSentBreakdown([
      { eventType: 'ec.order.confirmed', today: 12, last30d: 100 },
      { eventType: 'ec.order.shipped', today: 8, last30d: 80 },
    ], settings)
    expect(text).toBe('注文受付 12・発送完了 8')
  })

  it('内訳に内部の名前（ec.order.）を出さない', () => {
    const text = buildSentBreakdown([
      { eventType: 'ec.order.confirmed', today: 12, last30d: 100 },
      { eventType: 'ec.order.payment_received', today: 5, last30d: 50 },
    ], settings)
    expect(text).not.toContain('ec.order.')
    expect(text).not.toContain('payment_received')
  })

  it('設定に無い eventType は「その他 N」にまとめる', () => {
    const text = buildSentBreakdown([
      { eventType: 'ec.order.confirmed', today: 12, last30d: 100 },
      { eventType: 'ec.order.payment_received', today: 5, last30d: 50 },
      { eventType: 'ec.order.mystery', today: 3, last30d: 30 },
    ], settings)
    expect(text).toBe('注文受付 12・その他 8')
  })

  it('読めていないときは空文字のままにする（0 とは書かない）', () => {
    expect(buildSentBreakdown(null, settings)).toBe('')
    expect(buildSentBreakdown(undefined, settings)).toBe('')
    expect(buildSentBreakdown([], settings)).toBe('')
  })

  it('今日 0 件の種類は文に出さない', () => {
    const text = buildSentBreakdown([
      { eventType: 'ec.order.confirmed', today: 0, last30d: 100 },
      { eventType: 'ec.order.shipped', today: 8, last30d: 80 },
    ], settings)
    expect(text).toBe('発送完了 8')
  })
})
