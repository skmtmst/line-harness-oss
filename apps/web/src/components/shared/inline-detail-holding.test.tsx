// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import FolderAddDialog from './folder-add-dialog'
import { InlineDetailHoldingContext, useInlineDetailGuard, useInlineDetailHoldingState } from './use-inline-detail-guard'

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
afterEach(cleanup)

function Detail() {
  const guard = useInlineDetailGuard('row')
  return <button onClick={() => guard.editor.onDirtyChange(true)}>詳細を変更</button>
}
function Host() {
  const { holding, onHoldingChange } = useInlineDetailHoldingState()
  const [open, setOpen] = useState(false)
  return <InlineDetailHoldingContext.Provider value={onHoldingChange}>
    <span>{holding ? '保持中' : '保持なし'}</span>
    <Detail />
    <button onClick={() => setOpen(true)}>窓を開く</button>
    {open && <FolderAddDialog kind="form" accountId="a" onClose={() => setOpen(false)} onAdded={() => {}} />}
  </InlineDetailHoldingContext.Provider>
}
it('詳細が未保存なら空のフォルダ窓を閉じても保持を続ける', () => {
  window.history.replaceState(null, '', '/tags?row=one')
  render(<Host />)
  fireEvent.click(screen.getByRole('button', { name: '詳細を変更' }))
  expect(screen.getByText('保持中')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '窓を開く' }))
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(screen.getByText('保持中')).toBeTruthy()
})
