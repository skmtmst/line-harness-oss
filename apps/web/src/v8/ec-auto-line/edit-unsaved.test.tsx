// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import EditDrawer from './edit-drawer'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/use-insert-token-names', () => ({ useInsertTokenNames: () => [] }))
afterEach(cleanup)
it('自動LINEの本文を書き換えたら画面の移動前に確かめる', () => {
  const rule = { kind: 'cart' as const, enabled: true, waitMinutes: 60, messages: [{ type: 'text' as const, text: 'もとの本文' }], version: 3, testMode: true }
  render(<><a href="/templates">テンプレート</a><EditDrawer accountId="a" rule={rule} onClose={vi.fn()} onSaved={vi.fn()} /></>)
  const input = screen.getByLabelText('本文')
  input.textContent = '新しい本文'
  fireEvent.input(input)
  fireEvent.click(screen.getByRole('link', { name: 'テンプレート' }))
  expect(screen.getByText('保存していない変更があります')).toBeTruthy()
})
it('本文を変更してキャンセルすると確認し、編集へ戻れば入力が残る', () => {
  const rule = { kind: 'cart' as const, enabled: true, waitMinutes: 60, messages: [{ type: 'text' as const, text: 'もとの本文' }], version: 3, testMode: true }
  const close = vi.fn()
  render(<EditDrawer accountId="a" rule={rule} onClose={close} onSaved={vi.fn()} />)
  const input = screen.getByLabelText('本文')
  input.textContent = '新しい本文'; fireEvent.input(input)
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(screen.getByRole('dialog', { name: '入力を破棄しますか？' })).toBeTruthy()
  expect(close).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
  expect(input.textContent).toBe('新しい本文')
})
