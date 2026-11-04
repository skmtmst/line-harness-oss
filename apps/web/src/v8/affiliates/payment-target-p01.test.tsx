// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => ({ confirm: vi.fn() }))
vi.mock('@/components/shared/operation-target-summary', () => ({ default: ({ accounts }: { accounts: { id: string }[] }) => <div data-testid="operation-account">{accounts.map(a => a.id).join(',')}</div> }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, affiliates: { ...actual.api.affiliates,
    paymentPreview: async () => ({ success: true, data: { amount: 100, conversionCount: 1, breakdown: [], closeDate: null, paymentDate: null } }),
    get: async () => ({ success: true, data: {} }), confirmPayment: calls.confirm,
  } } }
})
import { AffiliatePaymentConfirmDialog } from './dialogs'
afterEach(() => { cleanup(); calls.confirm.mockReset() })
const props = { target: { id: 'person', name: '紹介者' }, settlement: null, periodTo: null, onClose: vi.fn(), onConfirmed: vi.fn() }
it('確認したアカウントを表示し、切り替え後の古い窓から確定できない', async () => {
  const view = render(<AffiliatePaymentConfirmDialog {...props} accountId="account-a" />)
  await screen.findByRole('button', { name: /100.*確定する/ })
  expect(screen.getByTestId('operation-account').textContent).toBe('account-a')
  view.rerender(<AffiliatePaymentConfirmDialog {...props} accountId="account-b" />)
  expect(screen.getByTestId('operation-account').textContent).toBe('account-a')
  view.rerender(<AffiliatePaymentConfirmDialog {...props} accountId="account-a" />)
  expect(screen.getByText('アカウントが変わりました。窓を閉じて選び直してください')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /100.*確定する/ })).toBeNull()
  expect(calls.confirm).not.toHaveBeenCalled()
  expect(screen.getByTestId('operation-account').textContent).toBe('account-a')
})

it('確認した同じアカウントに確定を送る', async () => {
  calls.confirm.mockResolvedValue({ success: false, error: 'test' })
  render(<AffiliatePaymentConfirmDialog {...props} accountId="account-a" />)
  fireEvent.click(await screen.findByRole('button', { name: /100.*確定する/ }))
  expect(calls.confirm).toHaveBeenCalledWith('person', expect.objectContaining({ lineAccountId: 'account-a', expectedAmount: 100 }))
})

it('アカウントが未確定の場合は不明であることを知らせる', async () => {
  render(<AffiliatePaymentConfirmDialog {...props} accountId="" />)
  expect(await screen.findByText(/対象のLINEアカウントを確認できません/)).toBeTruthy()
  expect((await screen.findByRole('button', { name: /100.*確定する/ }) as HTMLButtonElement).disabled).toBe(true)
})

it('閉じた窓の古い操作は実行しない', async () => {
  const view = render(<AffiliatePaymentConfirmDialog {...props} accountId="account-a" />)
  const button = await screen.findByRole('button', { name: /100.*確定する/ })
  const key = Object.keys(button).find(k => k.startsWith('__reactProps$'))!
  const old = (button as unknown as Record<string, { onClick: () => void }>)[key].onClick
  view.rerender(<AffiliatePaymentConfirmDialog {...props} target={null} accountId="account-a" />)
  old()
  expect(calls.confirm).not.toHaveBeenCalled()
})
