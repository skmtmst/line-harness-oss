import { describe, expect, it } from 'vitest'
import type { Area } from '@/components/rich-menus/canvas-editor'
import { isAreaActionConfigured, saveAreaDraft, unsetAreaLabels } from './action-drafts'

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
