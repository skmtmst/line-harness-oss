import { describe, expect, it } from 'vitest'
import { describeTemplateDiff } from './template-conflict-diff'

const base = {
  name: '店舗のご案内',
  category: '',
  folderId: null,
  messageType: 'text',
  messageContent: 'こんにちは',
}

describe('テンプレートの競合の違い比べ', () => {
  it('同じ内容なら行が出ない', () => {
    expect(describeTemplateDiff({ ...base }, { ...base })).toEqual([])
  })

  it('名前・本文・形の違いを拾う', () => {
    const lines = describeTemplateDiff(
      { ...base, name: '新しい名前', messageContent: '変わった文' },
      base,
    )
    expect(lines.some((line) => line.includes('テンプレート名'))).toBe(true)
    expect(lines.some((line) => line.includes('本文'))).toBe(true)
  })
})
