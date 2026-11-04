// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AccountWithStats } from '@/contexts/account-context'
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
import { AccountArchiveDialogV8 } from './account-dialogs'

afterEach(cleanup)
it('保管するLINEアカウントと環境を確認できる', () => {
  const account = { id: 'archive-a', name: '保管する本店', displayName: '保管する本店' } as AccountWithStats
  render(<AccountArchiveDialogV8 account={account} onClose={vi.fn()} onDone={vi.fn()} />)
  const dialog = screen.getByRole('dialog', { name: /アーカイブしますか/ })
  expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
  expect(within(dialog).getByText('環境')).toBeTruthy()
})

it('アーカイブ理由を編集中は画面移動前に確認する', async () => {
  window.history.replaceState(null, '', '/hq')
  const account = { id: 'archive-a', name: '保管する本店', displayName: '保管する本店' } as AccountWithStats
  render(<><AccountArchiveDialogV8 account={account} onClose={vi.fn()} onDone={vi.fn()} /><a href="/events">イベントへ</a></>)
  fireEvent.change(screen.getByLabelText('アーカイブの理由'), { target: { value: '使用終了' } })
  fireEvent.click(screen.getByRole('link', { name: 'イベントへ' }))
  expect(await screen.findByRole('dialog', { name: '保存していない変更があります' })).toBeTruthy()
})
