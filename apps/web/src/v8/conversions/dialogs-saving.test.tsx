// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: null }) }))
import { ConversionEditDialog, type ConversionEditDialogProps } from './dialogs'
afterEach(cleanup)
it('成果地点の保存中は×・キャンセル・Escで編集を消さない', () => {
  const close = vi.fn()
  const props: ConversionEditDialogProps = {
    editTarget: { name: '購入' } as ConversionEditDialogProps['editTarget'], setEditTarget: close,
    editForm: { name: '購入', sourceType: 'ec_order_confirmed', deduplicationMode: 'every', deduplicationWindowDays: '', valueMode: 'source', fixedValue: '', reversalPolicy: 'source_cancelled', attributionDays: '30', targetUrl: '', sourceConfig: {}, ingestEnabled: true } as unknown as ConversionEditDialogProps['editForm'],
    setEditForm: vi.fn(), editValueModeNotice: null, setEditValueModeNotice: vi.fn(), editSaving: false, editError: '', submitEdit: vi.fn(),
  }
  const view = render(<ConversionEditDialog {...props} />)
  view.rerender(<ConversionEditDialog {...props} editSaving />)
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
})
