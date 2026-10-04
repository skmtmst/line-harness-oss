import { describe, expect, it } from 'vitest'
import { describeTagDiff } from './tag-conflict-diff'
import type { TagDefinition } from '@/lib/api'
import type { TagEditorValues } from '@/components/friend-fields/tag-editor-v4'
import type { Tag } from '@line-crm/shared'

/*
 * タグの編集競合（`xn95q`）「違いを比べる」の差分取り出し。
 * 自分の入力と相手の最新の版を比べ、変わった所だけ文にする。
 */

function values(overrides: Partial<TagEditorValues> = {}): TagEditorValues {
  return {
    name: '常連',
    groupId: '',
    isStarred: false,
    linked: false,
    rewardMiles: 0,
    referralRewardMiles: 0,
    multiplierBps: null,
    multiplierPriority: 0,
    applyToExisting: false,
    reapplyPolicy: 'first_only',
    actions: [],
    ...overrides,
  }
}

function definition(tagOverrides: Partial<Tag> = {}): TagDefinition {
  return {
    tag: {
      id: 'tag-1',
      name: '常連',
      groupId: '',
      isStarred: false,
      mileageReward: 0,
      referralMileageReward: 0,
      mileageMultiplierBps: null,
      ...tagOverrides,
    } as Tag,
    automation: null,
  }
}

describe('タグの競合の違い比べ', () => {
  it('同じなら行が出ない', () => {
    expect(describeTagDiff(values(), definition())).toEqual([])
  })

  it('タグ名の違いは両方の名入りで1行', () => {
    const lines = describeTagDiff(values({ name: 'VIP' }), definition({ name: '常連' }))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('最新「常連」')
    expect(lines[0]).toContain('あなた「VIP」')
  })

  it('フォルダ・星の違いは基本設定にまとめる', () => {
    const lines = describeTagDiff(values({ isStarred: true }), definition())
    expect(lines).toEqual(['基本設定（フォルダ・一覧への表示）が違います'])
  })

  it('連動のON／OFFの違いを出す', () => {
    const lines = describeTagDiff(values({ linked: true }), definition())
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('ON／OFF')
  })

  it('連動ON同士ならマイル・倍率・付け直しを比べる', () => {
    const mine = values({ linked: true, rewardMiles: 10, multiplierBps: 15000 })
    const incoming = definition({ mileageReward: 10, mileageMultiplierBps: 20000 })
    expect(describeTagDiff(mine, incoming)).toEqual(['今後のマイル倍率が違います'])
  })

  it('連動アクションの数の違いを出す', () => {
    const mine = values({ linked: true, actions: [{ id: 'a1' }] as never })
    const incoming = definition({ mileageReward: 1 })
    incoming.automation = { id: 'am1', name: '', status: 'draft', draftVersion: null, publishedVersion: null, actions: [] }
    const lines = describeTagDiff(mine, incoming)
    expect(lines.some((line) => line.includes('連動アクション'))).toBe(true)
  })
})
