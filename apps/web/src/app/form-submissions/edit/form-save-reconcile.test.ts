/*
 * M003：送った中身と保存されている中身の比べ方。
 * 同じものは同じ、違うものは違うと判定することを見る。
 */
import { describe, expect, it } from 'vitest'
import { normalizeLiffFormAppearance } from '@line-crm/shared'
import { formSavedContentMatches, type FormSavedContent } from './form-save-reconcile'

function content(overrides: Partial<FormSavedContent> = {}): FormSavedContent {
  return {
    name: 'アンケート',
    description: null,
    layout: { version: 2, header: [], sections: [] },
    onSubmitTagId: null,
    isActive: false,
    ogTitle: null,
    ogDescription: null,
    ogImageUrl: null,
    liffAppearance: normalizeLiffFormAppearance(undefined),
    ...overrides,
  }
}

describe('formSavedContentMatches（M003：自分の再送の見分け）', () => {
  it('同じ中身は同じとみなす', () => {
    expect(formSavedContentMatches(content(), content())).toBe(true)
  })

  it('鍵の順序が違っても同じとみなす', () => {
    const sent = content({ layout: { version: 2, header: [], sections: [{ id: 's1', name: '質問', blocks: [] }] } })
    const current = content({ layout: { sections: [{ blocks: [], name: '質問', id: 's1' }], header: [], version: 2 } })
    expect(formSavedContentMatches(sent, current)).toBe(true)
  })

  it('名前が違えば他人の変更とみなす', () => {
    expect(formSavedContentMatches(content(), content({ name: '別の名前' }))).toBe(false)
  })

  it('紹介文・タグ・公開状態の違いも他人の変更とみなす', () => {
    expect(formSavedContentMatches(content(), content({ description: '説明' }))).toBe(false)
    expect(formSavedContentMatches(content(), content({ onSubmitTagId: 'tag-1' }))).toBe(false)
    expect(formSavedContentMatches(content(), content({ isActive: true }))).toBe(false)
  })

  it('ブロックの中身が違えば他人の変更とみなす', () => {
    const sent = content({ layout: { version: 2, header: [], sections: [] } })
    const current = content({ layout: { version: 2, header: [{ id: 'b1' }], sections: [] } })
    expect(formSavedContentMatches(sent, current)).toBe(false)
  })

  it('見た目だけの違いも他人の変更とみなす', () => {
    const sent = content()
    const current = content({
      liffAppearance: normalizeLiffFormAppearance({ mode: 'custom', theme: 'night' }),
    })
    expect(formSavedContentMatches(sent, current)).toBe(false)
    expect(formSavedContentMatches(sent, content())).toBe(true)
  })
})
