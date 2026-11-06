// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { VisitStampCard } from '@line-crm/shared'

const fx = vi.hoisted(() => ({ issueStaffQr: vi.fn(), revokeStaffQr: vi.fn() }))
vi.mock('@/lib/visit-stamps-api', () => ({ visitStampsApi: fx }))
vi.mock('@/lib/qr-image', () => ({ qrToDataURL: vi.fn() }))
import { StaffQr } from './qr'

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('会計金額の誤りを欄へ結び付け、入力へ移り、打ち直すと赤と理由を消す', async () => {
  const card = { id: 'card-1', name: '来店スタンプ', settings: { mode: 'amount', amountUnit: 1000, maxPerVisit: 3 } } as VisitStampCard
  render(<StaffQr card={card} accountId="acc-1" shop="店舗" onClose={() => {}} />)
  const input = screen.getByRole('textbox', { name: '会計の金額' })
  fireEvent.click(screen.getByRole('button', { name: 'QR を出す' }))
  const error = await screen.findByRole('alert')
  expect(error.textContent).toBe('1個以上たまる会計金額を入れてください。')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id)
  expect(document.activeElement).toBe(input)
  expect(fx.issueStaffQr).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: '1000' } })
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(input.getAttribute('aria-invalid')).not.toBe('true')
  expect(input.getAttribute('aria-describedby')).toBeNull()
})
