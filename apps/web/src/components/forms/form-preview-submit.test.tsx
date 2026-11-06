// @vitest-environment happy-dom

import { cleanup, render, fireEvent, screen } from '@testing-library/react'
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
    expect(view.getByText('送信する')).toBeTruthy()
  })
})

describe('F-11 回答プレビューの5段階評価・住所', () => {
  afterEach(() => {
    cleanup()
  })

  it('評価は★5つを出す', () => {
    const layout = emptyLayout()
    layout.sections[0].blocks = [
      { id: 'b1', kind: 'input', type: 'rating', name: 's', label: '満足度', defaultValue: '4' },
    ]
    const view = render(<FormPreview layout={layout} sectionIndex={0} />)
    expect(view.getByText('満足度')).toBeTruthy()
    // ★5つの塊が1つある（初期値の数だけ塗るのは見た目のため数えない）
    expect(view.container.textContent).toContain('★★★★★')
  })

  it('住所は郵便番号と住所の箱を出す', () => {
    const layout = emptyLayout()
    layout.sections[0].blocks = [
      { id: 'b1', kind: 'input', type: 'address', name: 'a', label: '住所' },
    ]
    const view = render(<FormPreview layout={layout} sectionIndex={0} />)
    expect(view.getByText('住所')).toBeTruthy()
    expect(view.container.textContent).toContain('___-____')
  })
})

it('WEB-146: 画像の失敗後にURLを変更すると新しい画像を読み込める', () => {
  const layout = emptyLayout()
  layout.sections[0].blocks = [{ id: 'image-1', kind: 'image', mediaUrl: 'https://example.test/old.png', size: 'full' }]
  const view = render(<FormPreview layout={layout} sectionIndex={0} />)
  fireEvent.error(view.container.querySelector('img')!)
  expect(screen.getByText(/画像を読み込めませんでした/)).toBeTruthy()
  const next = { ...layout, sections: [{ ...layout.sections[0], blocks: [{ id: 'image-1', kind: 'image' as const, mediaUrl: 'https://example.test/new.png', size: 'full' as const }] }] }
  view.rerender(<FormPreview layout={next} sectionIndex={0} />)
  const image = view.container.querySelector('img')!
  expect(image?.getAttribute('src')).toBe('https://example.test/new.png')
  expect(screen.queryByText(/画像を読み込めませんでした/)).toBeNull()
  fireEvent.load(image)
  expect(screen.queryByText('画像を読み込んでいます')).toBeNull()
  cleanup()
 })
