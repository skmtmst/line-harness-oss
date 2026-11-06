// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import FolderAddDialog from './folder-add-dialog'

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())

afterEach(() => cleanup())

it('フォルダ名の編集中に移動すると入力を残して確認する', async () => {
  window.history.replaceState(null, '', '/forms')
  render(<><FolderAddDialog kind="form" accountId="a" onClose={() => {}} onAdded={() => {}} /><a href="/events">イベントへ</a></>)
  fireEvent.change(screen.getByRole('textbox', { name: 'フォルダ名' }), { target: { value: '新しい分類' } })
  fireEvent.click(screen.getByRole('link', { name: 'イベントへ' }))
  expect(await screen.findByRole('dialog', { name: '保存していない変更があります' })).toBeTruthy()
  expect((screen.getByRole('textbox', { name: 'フォルダ名' }) as HTMLInputElement).value).toBe('新しい分類')
})

it('色だけを変更しても画面移動前に確認する', async () => {
  window.history.replaceState(null, '', '/forms')
  render(<><FolderAddDialog kind="form" accountId="a" onClose={() => {}} onAdded={() => {}} /><a href="/events">イベントへ</a></>)
  fireEvent.click(screen.getByRole('button', { name: 'フォルダの色：青' }))
  fireEvent.click(screen.getByRole('radio', { name: '赤' }))
  fireEvent.click(screen.getByRole('link', { name: 'イベントへ' }))
  expect(await screen.findByRole('dialog', { name: '保存していない変更があります' })).toBeTruthy()
})
