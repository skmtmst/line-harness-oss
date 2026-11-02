import { describe, expect, it } from 'vitest'
import { emptyLayout } from '@line-crm/shared'
import { readFormEditorDraft } from './hq-form-editor-draft'

describe('form editor session input', () => {
  it('名前が空でも設問以外の途中入力を復元し、空白を削らない', () => {
    const layout = emptyLayout()
    layout.options.thanksText = ' 架空のお礼 '
    expect(readFormEditorDraft({ kind: 'form', name: '', description: ' 途中 ', onSubmitTagId: '', layout }))
      .toMatchObject({ name: '', description: ' 途中 ', layout: { options: { thanksText: ' 架空のお礼 ' } } })
  })
  it.each([null, { kind: 'tag', name: '' }, { kind: 'form', name: '', description: '', onSubmitTagId: '', layout: {} }, { kind: 'form', name: '', description: 10, onSubmitTagId: '', layout: emptyLayout() }])('壊れた記録は初期値として渡さない', (draft) => {
    expect(readFormEditorDraft(draft)).toBeNull()
  })
})
