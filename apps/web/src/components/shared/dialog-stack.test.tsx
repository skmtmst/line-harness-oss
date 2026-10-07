// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Dialog from './dialog'
function Stack({ busy = false }: { busy?: boolean }) {
  const [child, setChild] = useState(true)
  return <Dialog open title="親" onCancel={parentClosed} onConfirm={() => {}}>
    {child && <Dialog open busy={busy} title="子" onCancel={() => { childClosed(); setChild(false) }} onConfirm={() => {}} />}
  </Dialog>
}
const parentClosed = vi.fn(), childClosed = vi.fn()
beforeEach(() => { vi.clearAllMocks(); document.documentElement.dataset.theme = 'v8' })
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })
it('重ねた窓のEscは最前面だけを閉じ、次のEscで親を閉じる', () => {
  render(<Stack />)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(childClosed).toHaveBeenCalledTimes(1)
  expect(parentClosed).not.toHaveBeenCalled()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(parentClosed).toHaveBeenCalledTimes(1)
})
it('最前面が保存中ならEscで親も閉じない', () => {
  render(<Stack busy />)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(childClosed).not.toHaveBeenCalled()
  expect(parentClosed).not.toHaveBeenCalled()
})
it('親が再描画されてもフォーカスとEscは子が受け持つ', () => {
  const view = render(<Stack />)
  view.rerender(<Stack busy />)
  view.rerender(<Stack />)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(childClosed).toHaveBeenCalledTimes(1)
  expect(parentClosed).not.toHaveBeenCalled()
})

it('最後の窓を閉じると元のスクロール状態へ戻る', () => {
  document.body.style.overflow = 'auto'
  const view = render(<Stack />)
  expect(document.body.style.overflow).toBe('hidden')
  view.unmount()
  expect(document.body.style.overflow).toBe('auto')
})
