// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import MessageComposer from './message-composer'

vi.mock('@/components/scenarios/insert-toolbar', () => ({ default: () => null }))
vi.mock('@/components/scenarios/message-kind-fields', () => ({ default: () => null, emptyMessageKindState: () => ({}) }))
vi.mock('./message-composer-media', () => ({ default: () => null }))
afterEach(cleanup)

it('境界の移動と最後の削除に理由を出し、本文を保つ', () => {
  const onMove = vi.fn(), onDelete = vi.fn()
  const props = { accountId: null, onMove, onDelete, onChange: vi.fn(), onAdd: vi.fn(), onPickTemplate: vi.fn(), onSaveTemplate: vi.fn(), onCompose: vi.fn() }
  const bubbles = [{ id: 'one', type: 'text' as const, content: { text: '保存する本文' } }]
  const { rerender } = render(<MessageComposer {...props} bubbles={bubbles} />)
  for (const [name, reason] of [['1通目を上へ移動', '最初のメッセージです。'], ['1通目を下へ移動', '最後のメッセージです。'], ['1通目を削除する', 'メッセージは1通以上必要です。']]) {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe(reason)
    fireEvent.click(button)
  }
  expect(onMove).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
  expect((screen.getByLabelText('本文') as HTMLTextAreaElement).value).toBe('保存する本文')
  rerender(<MessageComposer {...props} bubbles={[...bubbles, { ...bubbles[0], id: 'two' }]} />)
  const down = screen.getByRole('button', { name: '1通目を下へ移動' }) as HTMLButtonElement
  expect(down.disabled).toBe(false)
  expect(down.title).toBe('')
  fireEvent.click(down)
  expect(onMove).toHaveBeenCalledWith(0, 1)
  rerender(<MessageComposer {...props} bubbles={bubbles} busy />)
  expect(screen.getByRole('button', { name: '1通目を上へ移動' }).title).toBe('処理中です。完了してから操作してください。')
})
