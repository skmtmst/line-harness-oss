// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AccountWithStats } from '@/contexts/account-context'
import { AccountArchiveDialogV8 } from './account-dialogs'

afterEach(cleanup)
it('保管するLINEアカウントと環境を確認できる', () => {
  const account = { id: 'archive-a', name: '保管する本店', displayName: '保管する本店' } as AccountWithStats
  render(<AccountArchiveDialogV8 account={account} onClose={vi.fn()} onDone={vi.fn()} />)
  const dialog = screen.getByRole('dialog', { name: /アーカイブしますか/ })
  expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
  expect(within(dialog).getByText('環境')).toBeTruthy()
})
