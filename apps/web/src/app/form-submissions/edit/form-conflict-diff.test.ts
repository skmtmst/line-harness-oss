import { describe, expect, it } from 'vitest'
import type { FormLayout } from '@line-crm/shared'
import { describeConflictDiff, type ConflictSide } from './form-conflict-diff'

function layout(sections: FormLayout['sections']): FormLayout {
  return {
    version: 2,
    header: [],
    sections,
    options: {
      thanksUrl: null,
      thanksText: 'ありがとうございました。',
      restorePrevious: false,
      pageTitle: null,
      submitLabel: '送信',
      prevLabel: '前へ',
      nextLabel: '次へ',
      sectionHeader: 'pageNumber',
      confirmDialog: { enabled: false },
      deadline: { enabled: false },
      oncePerFriend: { enabled: false },
      totalLimit: { enabled: false },
      afterActions: [],
    },
  }
}

function side(name: string, sections: FormLayout['sections']): ConflictSide {
  return { name, description: '', layout: layout(sections) }
}

describe('競合の違い比べ', () => {
  it('同じ内容なら行が出ない', () => {
    const sections: FormLayout['sections'] = [
      {
        id: 's1',
        name: '質問',
        blocks: [{ id: 'b1', kind: 'input', input: 'single', label: '名前', required: false }],
      },
    ]
    const { lines, omitted } = describeConflictDiff(side('A', sections), side('A', layout(sections).sections))
    expect(lines).toEqual([])
    expect(omitted).toBe(0)
  })

  it('フォーム名・ページの追加削除・ブロックの変更を拾う', () => {
    const mine = side('新しい名前', [
      {
        id: 's1',
        name: '質問',
        blocks: [{ id: 'b1', kind: 'input', input: 'single', label: '名前（必須）', required: true }],
      },
      { id: 's2', name: '追加ページ', blocks: [] },
    ])
    const incoming = side('古い名前', [
      {
        id: 's1',
        name: '質問',
        blocks: [{ id: 'b1', kind: 'input', input: 'single', label: '名前', required: false }],
      },
      { id: 's9', name: '消す予定のページ', blocks: [] },
    ])
    const { lines, omitted } = describeConflictDiff(mine, incoming)
    expect(omitted).toBe(0)
    const texts = lines.map((l) => l.text)
    expect(texts.some((t) => t.includes('フォーム名'))).toBe(true)
    expect(lines.find((l) => l.text.includes('追加ページ'))?.kind).toBe('add')
    expect(lines.find((l) => l.text.includes('消す予定のページ'))?.kind).toBe('remove')
    expect(lines.find((l) => l.text.includes('名前') && l.kind === 'change')).toBeTruthy()
  })

  it('多いときは先頭だけにして残り件数を返す', () => {
    const mine = side('A', [
      {
        id: 's1',
        name: '質問',
        blocks: Array.from({ length: 30 }, (_, i) => ({
          id: `mine-${i}`,
          kind: 'input' as const,
          input: 'single' as const,
          label: `追加${i}`,
          required: false,
        })),
      },
    ])
    const incoming = side('A', [{ id: 's1', name: '質問', blocks: [] }])
    const { lines, omitted } = describeConflictDiff(mine, incoming, 5)
    expect(lines).toHaveLength(5)
    expect(omitted).toBe(25)
  })
})
