// @vitest-environment happy-dom
/* 流入のフォルダ名の窓：日本語の変換を確定する Enter で保存しない（監査 WEB-018 の関連）。 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/api', () => ({
  api: { entryRouteGenres: apiMock },
  ApiError: class ApiError extends Error { status = 0 },
}))

import GenreDialog from './genre-dialog'

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  vi.clearAllMocks()
  apiMock.create.mockResolvedValue({ success: true, data: { id: 'g1', name: 'A店' } })
})
afterEach(cleanup)

it('変換中の Enter では作らず、変換が終わった Enter で作る', async () => {
  const onSaved = vi.fn()
  render(<GenreDialog genre={null} onClose={vi.fn()} onSaved={onSaved} />)
  const input = screen.getByLabelText('フォルダ名')
  fireEvent.change(input, { target: { value: 'えーてん' } })
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  })
  expect(apiMock.create).not.toHaveBeenCalled()
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  expect(apiMock.create).toHaveBeenCalledWith('えーてん')
})
