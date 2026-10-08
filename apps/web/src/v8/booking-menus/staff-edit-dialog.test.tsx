// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/api', () => ({ api: { staff: { list: async () => ({ success: true, data: [] }) } } }))
import { StaffEditModal } from './staff-edit-dialog'
afterEach(cleanup)
it('保存中は×・キャンセル・Escを止め、失敗後は閉じられる', async () => {
  let reject!: (reason: Error) => void
  const onSave = vi.fn(() => new Promise<void>((_resolve, rejectSave) => { reject = rejectSave }))
  const onClose = vi.fn()
  render(<StaffEditModal staff={{ name: 'staff', display_name: '担当者', is_active: 1 }} onSave={onSave} onClose={onClose} />)
  await act(async () => {})
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存する' })) })
  expect(onSave).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { reject(new Error('保存失敗')) })
  expect(screen.getByText('保存失敗')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})
