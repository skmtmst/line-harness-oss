import { describe, expect, it } from 'vitest'
import type { SegmentCondition } from '@/lib/segment-condition'
import { NOT_AVAILABLE, afterSendIsPause, afterSendText, stepTargetText } from './step-row-view'

const cond = (rules: SegmentCondition['rules'], groups?: SegmentCondition[]): SegmentCondition => ({
  operator: 'AND', rules, ...(groups ? { groups } : {}),
})

describe('送信後', () => {
  it('決まっている値を — にしない', () => {
    /*
      `continue` は「次へ進む」という決まっている値で、取れていないわけではない。
      `—` にすると、決めていないのか読めていないのか見分けられない。
    */
    expect(afterSendText('continue')).toBe('次へ進む')
    expect(afterSendText('pause')).toBe('返信まで一時停止')
  })

  it('取れていないときだけ —', () => {
    expect(afterSendText(null)).toBe(NOT_AVAILABLE)
    expect(afterSendText(undefined)).toBe(NOT_AVAILABLE)
  })

  it('止まるほうだけ目立たせる', () => {
    expect(afterSendIsPause('pause')).toBe(true)
    expect(afterSendIsPause('continue')).toBe(false)
  })
})

describe('配信対象', () => {
  it('null は購読中の全員。未取得ではない', () => {
    expect(stepTargetText(null)).toBe('購読中の全員')
    expect(stepTargetText(undefined)).toBe(NOT_AVAILABLE)
  })

  it('書きかけの行は数えない', () => {
    // 保存していない行のぶんだけ「条件2件」と出て、効いている数と食い違う。
    const withDraft = cond([
      { type: 'tag_exists', value: 'tag-1' },
      { type: 'tag_exists', value: '' },
    ])
    expect(stepTargetText(withDraft, () => undefined)).toBe('条件 1件')
    expect(stepTargetText(cond([{ type: 'tag_exists', value: '' }]))).toBe('購読中の全員')
  })

  it('タグ1つなら名前で言う', () => {
    const one = cond([{ type: 'tag_exists', value: 'tag-1' }])
    expect(stepTargetText(one, (id) => (id === 'tag-1' ? '初回案内' : undefined))).toBe('タグ：初回案内')
  })

  it('名前が引けないときは内部IDを出さず件数で言う', () => {
    const one = cond([{ type: 'tag_exists', value: 'tag-unknown' }])
    const text = stepTargetText(one, () => undefined)
    expect(text).toBe('条件 1件')
    expect(text).not.toContain('tag-unknown')
  })

  it('入れ子の条件も数える', () => {
    const nested = cond(
      [{ type: 'tag_exists', value: 'tag-1' }],
      [cond([{ type: 'tag_exists', value: 'tag-2' }, { type: 'tag_exists', value: 'tag-3' }])],
    )
    expect(stepTargetText(nested)).toBe('条件 3件')
  })
})
