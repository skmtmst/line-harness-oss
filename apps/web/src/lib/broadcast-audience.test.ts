/*
 * 一斉配信の宛先の組み立て。
 *
 * ここが狂うと、**送ってから**しか分からない。多すぎれば送りすぎ、
 * 少なすぎれば届かない。どちらも取り消せない。
 */
import { describe, it, expect } from 'vitest'
import {
  buildAudienceCondition,
  audienceError,
  describeAudience,
  TARGET_MODES,
} from './broadcast-audience'

const empty = { scenarioId: '', tagId: '', condition: null }

describe('ブロック中の人を必ず外す', () => {
  it('どのやり方でも is_following が入る', () => {
    for (const mode of TARGET_MODES) {
      const built = buildAudienceCondition(mode.value, {
        scenarioId: '',
        tagId: 't1',
        condition: { operator: 'AND', rules: [{ type: 'private_memo', value: 'x' }] },
      })
      expect(built.rules).toContainEqual({ type: 'is_following', value: true })
    }
  })
})

describe('友だち全員', () => {
  it('絞り込みを足さない', () => {
    const built = buildAudienceCondition('all', empty)
    expect(built.rules).toEqual([{ type: 'is_following', value: true }])
    expect(built.groups).toEqual([])
  })
})

describe('シナリオ購読', () => {
  it('シナリオ未指定なら「どれか1つでも購読中」', () => {
    const built = buildAudienceCondition('scenario', empty)
    expect(built.rules).toContainEqual({ type: 'scenario_subscribed', value: '' })
  })

  it('指定すればそのシナリオ', () => {
    const built = buildAudienceCondition('scenario', { ...empty, scenarioId: 's1' })
    expect(built.rules).toContainEqual({ type: 'scenario_subscribed', value: 's1' })
  })
})

describe('タグ', () => {
  it('選んだタグで絞る', () => {
    const built = buildAudienceCondition('tag', { ...empty, tagId: 'tag1' })
    expect(built.rules).toContainEqual({ type: 'tag_exists', value: 'tag1' })
  })

  it('未選択なら保存させない（全員に届いてしまう）', () => {
    expect(audienceError('tag', empty)).not.toBe('')
  })
})

describe('詳細条件', () => {
  it('条件をそのまま持ち上げる', () => {
    const built = buildAudienceCondition('advanced', {
      ...empty,
      condition: {
        operator: 'AND',
        rules: [{ type: 'tag_exists', value: 'tag1' }],
        groups: [{ operator: 'OR', rules: [{ type: 'private_memo', value: 'VIP' }] }],
      },
    })
    expect(built.rules).toContainEqual({ type: 'tag_exists', value: 'tag1' })
    expect(built.groups).toHaveLength(1)
    expect(built.groups?.[0].operator).toBe('OR')
  })

  it('書きかけの行は落とす（worker が読めない条件になる）', () => {
    const built = buildAudienceCondition('advanced', {
      ...empty,
      condition: {
        operator: 'AND',
        rules: [
          { type: 'tag_exists', value: '' },
          { type: 'tag_exists', value: 'tag1' },
        ],
      },
    })
    expect(built.rules).toEqual([
      { type: 'is_following', value: true },
      { type: 'tag_exists', value: 'tag1' },
    ])
  })

  it('空のまま保存させない。絞ったつもりで全員に届くのを止める', () => {
    expect(audienceError('advanced', empty)).not.toBe('')
    expect(audienceError('advanced', {
      ...empty,
      condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: '' }] },
    })).not.toBe('')
  })

  it('1つでも書けていれば通す', () => {
    expect(audienceError('advanced', {
      ...empty,
      condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag1' }] },
    })).toBe('')
  })
})

describe('要約', () => {
  const names = { scenarios: [{ id: 's1', name: '初回フォロー' }], tags: [{ id: 't1', name: 'VIP' }] }

  it('選んだものの名前で出す', () => {
    expect(describeAudience('all', empty, names)).toContain('全員')
    expect(describeAudience('scenario', { ...empty, scenarioId: 's1' }, names)).toContain('初回フォロー')
    expect(describeAudience('tag', { ...empty, tagId: 't1' }, names)).toContain('VIP')
  })

  it('消えたタグを選んだままでも壊れない', () => {
    expect(describeAudience('tag', { ...empty, tagId: 'gone' }, names)).toBe('タグ未選択')
  })
})
