// @vitest-environment happy-dom
import { fireEvent, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { mount } from './owner-content-fixture'
it('WEB-143：空ページも削除前に確認し、取り消し可能とは案内しない', () => {
  const { onRemovePage } = mount()
  fireEvent.click(screen.getByRole('button', { name: /ページ「前半」のその他操作/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'このページを消す' }))
  expect(onRemovePage).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog').textContent).not.toContain('保存するまでは元に戻せます')
  fireEvent.click(screen.getByRole('button', { name: '消す' }))
  expect(onRemovePage).toHaveBeenCalledWith(0)
})
