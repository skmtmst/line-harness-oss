import { describe, expect, it } from 'vitest'
import type { Area } from '@/components/rich-menus/canvas-editor'
import { isAreaActionConfigured, pruneStaleAreaTags, saveAreaDraft, unsetAreaLabels } from './action-drafts'

function textArea(id: string, text = ''): Area {
  return {
    id,
    boundsX: 0,
    boundsY: 0,
    boundsWidth: 100,
    boundsHeight: 100,
    actionType: 'message',
    actionData: { text },
    intent: 'text',
  }
}

describe('リッチメニュー新規作成の面アクション', () => {
  it('面の設定保存で選んだ面だけを下書き状態へ反映する', () => {
    const areas = [textArea('a'), textArea('b')]
    const saved = saveAreaDraft(areas, 1, {
      ...textArea('b', '予約する'),
      tagIds: ['tag-1'],
      scoreChange: 10,
    })

    expect(isAreaActionConfigured(saved[0])).toBe(false)
    expect(isAreaActionConfigured(saved[1])).toBe(true)
    expect(saved[1].actionData).toEqual({ text: '予約する' })
    expect(saved[1].tagIds).toEqual(['tag-1'])
    expect(saved[1].scoreChange).toBe(10)
  })

  it('6面を設定すると未設定警告の対象がなくなる', () => {
    const areas = Array.from({ length: 6 }, (_, index) => textArea(String(index), `動作${index}`))
    expect(unsetAreaLabels(areas)).toEqual([])
  })
})

describe('R23 アカウント切替で前の候補にしかないタグを外す', () => {
  it('新しい候補にない選択だけを外し、件数を返す', () => {
    const drafts = {
      large: [
        { ...textArea('a', '予約する'), tagIds: ['tag-keep', 'tag-gone'] },
        { ...textArea('b', '買う'), tagIds: ['tag-keep'] },
      ],
    }
    const { next, removed } = pruneStaleAreaTags(drafts, new Set(['tag-keep']))
    expect(removed).toBe(1)
    expect(next.large[0].tagIds).toEqual(['tag-keep'])
    expect(next.large[1].tagIds).toEqual(['tag-keep'])
  })

  it('外すものがなければ面を作り直さない', () => {
    const area = { ...textArea('a', '予約する'), tagIds: ['tag-keep'] }
    const { next, removed } = pruneStaleAreaTags({ large: [area] }, new Set(['tag-keep']))
    expect(removed).toBe(0)
    expect(next.large[0]).toBe(area)
  })

  it('下書きが空でも壊れない', () => {
    expect(pruneStaleAreaTags({}, new Set(['tag-keep']))).toEqual({ next: {}, removed: 0 })
  })
})
