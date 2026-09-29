/*
 * SCENARIO-01 / SCENARIO-02 の回帰試験。
 *
 * - 01：保存済みの予定を開いてそのまま保存しても、分の端数が欠けない
 *   （90分が60分にならない）。日・時間・分を分けて持つ。
 * - 02：画像・動画などの保存値が1通目の入力欄へ戻る。読めない値は
 *   空欄で上書きせず、元の中身を保持する。
 */
import { describe, expect, it } from 'vitest'
import type { ScenarioStep } from '@line-crm/shared'
import {
  parseStepImageContent,
  restoreFirstStep,
  restoreKindState,
  scheduleFromStep,
  scheduleToPayload,
  tagIdFromCondition,
  type FirstStepSchedule,
} from './first-step-form'

function step(partial: Partial<ScenarioStep>): ScenarioStep {
  return {
    id: 's1',
    scenarioId: 'sc-1',
    stepOrder: 1,
    delayMinutes: 0,
    messageType: 'text',
    messageContent: '',
    createdAt: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('予定の往復（SCENARIO-01）', () => {
  it.each([1, 59, 60, 90, 1439])('elapsed: offsetMinutes=%i を往復しても同じ値', (mins) => {
    const s = scheduleFromStep('elapsed', step({ offsetDays: 0, offsetMinutes: mins }))
    expect(scheduleToPayload('elapsed', s)).toEqual({ offsetDays: 0, offsetMinutes: mins })
  })

  it('elapsed: 日をまたぐ値も日・時間・分で往復する', () => {
    // 2日と90分 = offsetDays 2 + offsetMinutes 90
    const s = scheduleFromStep('elapsed', step({ offsetDays: 2, offsetMinutes: 90 }))
    expect(s).toMatchObject({ offsetDays: 2, offsetHours: 1, offsetMinutesRemainder: 30 })
    expect(scheduleToPayload('elapsed', s)).toEqual({ offsetDays: 2, offsetMinutes: 90 })
  })

  it.each([1, 59, 60, 90, 1439, 1500, 3000])(
    'relative: delayMinutes=%i を日・時間・分へ分解して往復しても同じ値',
    (mins) => {
      const s = scheduleFromStep('relative', step({ delayMinutes: mins }))
      expect(scheduleToPayload('relative', s)).toEqual({ delayMinutes: mins })
    },
  )

  it('elapsed の旧データ（offsetMinutes を持たず delayMinutes だけ）は delayMinutes を分解する', () => {
    const s = scheduleFromStep('elapsed', step({ delayMinutes: 90, offsetMinutes: null }))
    expect(s).toMatchObject({ offsetDays: 0, offsetHours: 1, offsetMinutesRemainder: 30 })
    expect(scheduleToPayload('elapsed', s)).toEqual({ offsetDays: 0, offsetMinutes: 90 })
  })

  it('absolute_time: 日数と時刻をそのまま往復する', () => {
    const s = scheduleFromStep(
      'absolute_time',
      step({ offsetDays: 3, deliveryTime: '18:30', offsetMinutes: null }),
    )
    expect(s).toMatchObject({ offsetDays: 3, deliveryTime: '18:30' })
    expect(scheduleToPayload('absolute_time', s)).toEqual({ offsetDays: 3, deliveryTime: '18:30' })
  })

  it('入力欄から組み立てた値を方式ごとに分けて送る（余計な欄を送らない）', () => {
    const v: FirstStepSchedule = {
      offsetDays: 1,
      offsetHours: 2,
      offsetMinutesRemainder: 30,
      deliveryTime: '09:00',
    }
    expect(scheduleToPayload('relative', v)).toEqual({ delayMinutes: 1590 })
    expect(scheduleToPayload('elapsed', v)).toEqual({ offsetDays: 1, offsetMinutes: 150 })
    expect(scheduleToPayload('absolute_time', v)).toEqual({ offsetDays: 1, deliveryTime: '09:00' })
  })
})

describe('内容の復元（SCENARIO-02）', () => {
  it('画像の保存値をアップローダへ戻す', () => {
    const content = JSON.stringify({
      originalContentUrl: 'https://example.test/a.jpg',
      previewImageUrl: 'https://example.test/p.jpg',
    })
    const r = restoreFirstStep(step({ messageType: 'image', messageContent: content }), 'elapsed')
    expect(r.kind).toBe('image')
    expect(r.image).toEqual({
      mode: 'line-image',
      originalContentUrl: 'https://example.test/a.jpg',
      previewImageUrl: 'https://example.test/p.jpg',
    })
    expect(r.preserved).toBeNull()
  })

  it('読めない画像JSONは元の中身を保持し、理由を返す', () => {
    const r = restoreFirstStep(
      step({ messageType: 'image', messageContent: 'not-json' }),
      'elapsed',
    )
    expect(r.kind).toBe('image')
    expect(r.image).toBeNull()
    expect(r.preserved).toEqual({ messageType: 'image', messageContent: 'not-json' })
    expect(r.restoreNotice).toBeTruthy()
  })

  it('位置情報・動画・音声・スタンプを専用欄へ戻す', () => {
    const cases: Array<[string, string, (r: ReturnType<typeof restoreFirstStep>) => void]> = [
      [
        'location',
        JSON.stringify({ title: '本店', address: '渋谷区', latitude: 35.6, longitude: 139.7 }),
        (r) => {
          expect(r.kindState.location.latitude).toBe('35.6')
          expect(r.kindState.location.longitude).toBe('139.7')
        },
      ],
      [
        'video',
        JSON.stringify({ originalContentUrl: 'https://x/v.mp4', previewImageUrl: 'https://x/v.jpg' }),
        (r) => expect(r.kindState.video.originalContentUrl).toBe('https://x/v.mp4'),
      ],
      [
        'audio',
        JSON.stringify({ originalContentUrl: 'https://x/a.m4a', duration: 30000 }),
        (r) => expect(r.kindState.audio.duration).toBe('30'),
      ],
      [
        'sticker',
        JSON.stringify({ packageId: '446', stickerId: '1988' }),
        (r) => expect(r.kindState.sticker.stickerId).toBe('1988'),
      ],
    ]
    for (const [type, content, check] of cases) {
      const r = restoreFirstStep(step({ messageType: type as ScenarioStep['messageType'], messageContent: content }), 'elapsed')
      expect(r.kind).toBe(type)
      expect(r.preserved).toBeNull()
      check(r)
    }
  })

  it('組み立て直せない保存値は保持へ回す', () => {
    // previewImageUrl の無い動画はこの画面では完璧に復元できない。
    const r = restoreFirstStep(
      step({ messageType: 'video', messageContent: JSON.stringify({ originalContentUrl: 'https://x/v.mp4' }) }),
      'elapsed',
    )
    expect(r.kind).toBe('video')
    expect(r.preserved?.messageType).toBe('video')
    expect(r.restoreNotice).toBeTruthy()
  })

  it('テンプレートの通はテンプレート選択へ戻す', () => {
    const r = restoreFirstStep(step({ templateId: 'tpl-1', messageType: 'text' }), 'elapsed')
    expect(r.contentMode).toBe('template')
    expect(r.templateId).toBe('tpl-1')
  })

  it('カルーセルの通はテンプレート選択ではなくカルーセル種別へ戻す', () => {
    const r = restoreFirstStep(
      step({ messageType: 'carousel', templateId: 'tpl-9', messageContent: '[]' }),
      'elapsed',
    )
    expect(r.contentMode).toBe('compose')
    expect(r.kind).toBe('carousel')
    expect(r.templateId).toBe('tpl-9')
  })

  it('この画面に無い種別（Flex）は本文欄へ散らさず保持する', () => {
    const r = restoreFirstStep(
      step({ messageType: 'flex', messageContent: '{"type":"flex"}' }),
      'elapsed',
    )
    expect(r.preserved).toEqual({ messageType: 'flex', messageContent: '{"type":"flex"}' })
    expect(r.restoreNotice).toContain('Flex')
  })

  it('質問の通は質問欄へ戻す', () => {
    const q = { text: 'どれがいい？', choices: [{ label: 'A' }, { label: 'B' }] }
    const r = restoreFirstStep(step({ messageType: 'text', question: q }), 'elapsed')
    expect(r.kind).toBe('question')
    expect(r.question).toEqual(q)
  })

  it('タグ1つの条件はタグ欄へ、それ以外は詳細条件へ戻す', () => {
    const tagCond = { operator: 'AND' as const, rules: [{ type: 'tag_exists', value: 'tag-1' }] }
    const r1 = restoreFirstStep(step({ targetCondition: tagCond }), 'elapsed')
    expect(r1.targetMode).toBe('tag')
    expect(r1.targetTagId).toBe('tag-1')

    const multi = { operator: 'AND' as const, rules: [tagCond.rules[0], { type: 'name', value: { text: 'x' } }] }
    const r2 = restoreFirstStep(step({ targetCondition: multi }), 'elapsed')
    expect(r2.targetMode).toBe('advanced')
    expect(r2.targetCondition).toEqual(multi)

    const r3 = restoreFirstStep(step({ targetCondition: null }), 'elapsed')
    expect(r3.targetMode).toBe('all')
  })
})

describe('部品関数', () => {
  it('parseStepImageContent は previewImageUrl が無ければ original で埋める', () => {
    expect(parseStepImageContent(JSON.stringify({ originalContentUrl: 'https://x/a.jpg' }))).toEqual({
      mode: 'line-image',
      originalContentUrl: 'https://x/a.jpg',
      previewImageUrl: 'https://x/a.jpg',
    })
    expect(parseStepImageContent('{}')).toBeNull()
    expect(parseStepImageContent('123')).toBeNull()
    expect(parseStepImageContent('')).toBeNull()
  })

  it('restoreKindState は復元した欄から同じ形を組み立てられないとき null', () => {
    expect(
      restoreKindState('video', JSON.stringify({ originalContentUrl: 'https://x/v.mp4' })),
    ).toBeNull()
    expect(
      restoreKindState('sticker', JSON.stringify({ packageId: '446', stickerId: '1988' })),
    ).not.toBeNull()
  })

  it('tagIdFromCondition はタグ1つの条件だけ id を返す', () => {
    expect(
      tagIdFromCondition({ operator: 'AND', rules: [{ type: 'tag_exists', value: 't1' }] }),
    ).toBe('t1')
    expect(
      tagIdFromCondition({ operator: 'OR', rules: [{ type: 'tag_exists', value: 't1' }] }),
    ).toBeNull()
    expect(tagIdFromCondition(null)).toBeNull()
  })
})
