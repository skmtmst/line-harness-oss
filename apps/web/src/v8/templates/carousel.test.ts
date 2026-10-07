import { describe, expect, it } from 'vitest'
import type { InlineAction } from '@/components/auto-replies/draft-fields'
import { chipName, inlineActionsText } from './carousel'

describe('カルーセルを作る（J60utH）の札と動きの1行', () => {
  it('札の名前はタイトルの（）書きを外す', () => {
    expect(chipName('夏の定番セット（送料込み）')).toBe('夏の定番セット')
    expect(chipName('定期便')).toBe('定期便')
  })

  it('動きはタグの名前で、無ければ「何もしない（決める）」', () => {
    const tag = { key: 'k', actionType: 'tag', config: { op: 'add', tagIds: ['t1'] }, onFailure: 'continue' } as unknown as InlineAction
    expect(inlineActionsText([tag], [{ id: 't1', name: '夏セット興味' }])).toBe('タグ「夏セット興味」を付ける')
    expect(inlineActionsText([], [])).toBe('何もしない（決める）')
  })
})
