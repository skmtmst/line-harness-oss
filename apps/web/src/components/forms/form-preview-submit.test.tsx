// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import FormPreview from '@/components/forms/form-preview'
import { emptyLayout } from '@line-crm/shared'

describe('回答プレビューの送信口', () => {
  afterEach(() => {
    cleanup()
  })

  it('ボタン箱がある面では固定の送信口を出さず「送信する」は1つだけ', () => {
    const layout = emptyLayout()
    layout.sections[0].blocks = [
      { id: 'b3', kind: 'button', label: '送信する', url: '' },
    ]
    const view = render(<FormPreview layout={layout} sectionIndex={0} />)
    expect(view.getAllByText('送信する')).toHaveLength(1)
  })

  it('ボタン箱がない面では固定の送信口を出す', () => {
    const layout = emptyLayout()
    const view = render(<FormPreview layout={layout} sectionIndex={0} />)
    expect(view.getByText('送信')).toBeTruthy()
  })
})
