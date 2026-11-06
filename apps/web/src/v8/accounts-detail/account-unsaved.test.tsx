// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { LineAccount } from '@line-crm/shared'
import type { AccountDetailView } from './view'
import { CredentialsDialog, EditDialog } from './dialogs'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
afterEach(cleanup)
const account = { id: 'test-account', name: '確認用' } as LineAccount & AccountDetailView

it('接続情報を書きかけなら画面移動前に確かめる', () => {
  render(<><a href="/templates">テンプレート</a><CredentialsDialog account={account} kind="messaging" onClose={vi.fn()} onSaved={vi.fn()} /></>)
  fireEvent.change(screen.getByLabelText('Channel Secret'), { target: { value: 'dummy-value' } })
  fireEvent.click(screen.getByRole('link', { name: 'テンプレート' }))
  expect(screen.getByText('保存していない変更があります')).toBeTruthy()
})

it('登録内容を書き換えたら戻る前に確かめる', () => {
  render(<EditDialog account={account} canEditTimezone onClose={vi.fn()} onSaved={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('アカウント名'), { target: { value: '新しい名前' } })
  fireEvent.popState(window)
  expect(screen.getByText('保存していない変更があります')).toBeTruthy()
})
