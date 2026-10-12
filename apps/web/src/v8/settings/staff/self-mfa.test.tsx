// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SelfMfa from './self-mfa'
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), gate: vi.fn() }))
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), fetchApi: mocks.fetch }))
vi.mock('@/components/step-up-prompt', () => ({ useStepUpGate: () => ({ gate: mocks.gate, prompt: null }) }))
beforeEach(() => { mocks.fetch.mockReset(); mocks.gate.mockReset() }); afterEach(cleanup)
const self = { staffId: 'fixture-self', enabledAt: '2026-10-12T10:00:00Z', remaining: 2, canEdit: true, notice: null }
it('shows the low-code notice, confirms regeneration and displays the eight replacements only once', async () => {
  const codes = ['7K2Q-9FXM','B4TN-6WJP','H8RD-3CVY','M5ZL-2QKA','P9XE-7NHU','T3GW-8BSC','Y6JA-4DRV','C2FN-5MXT']
  mocks.fetch.mockResolvedValueOnce({ success: true, data: self }).mockResolvedValueOnce({ success: true, data: { recoveryCodes: codes } }).mockResolvedValueOnce({ success: true, data: { ...self, remaining: 8 } })
  mocks.gate.mockResolvedValue('fixture-grant')
  render(<SelfMfa />)
  await screen.findByText(/回復コードの残りが2個です/)
  fireEvent.click(screen.getByRole('button', { name: '回復コードを作り直す' }))
  await screen.findByRole('dialog')
  expect(mocks.fetch.mock.calls[1][1].headers).toEqual({ 'X-Step-Up-Token': 'fixture-grant' })
  expect(screen.getAllByRole('listitem')).toHaveLength(8)
  fireEvent.click(screen.getByRole('button', { name: '控えました' }))
  await waitFor(() => expect(screen.queryByText('7K2Q-9FXM')).toBeNull())
  expect(screen.queryByText(/回復コードの残りが2個です/)).toBeNull()
})
it('cancellation and read-only access never send a regeneration request', async () => {
  mocks.fetch.mockResolvedValue({ success: true, data: self }); mocks.gate.mockResolvedValue(null)
  const rendered = render(<SelfMfa />)
  fireEvent.click(await screen.findByRole('button', { name: '回復コードを作り直す' }))
  await waitFor(() => expect(mocks.gate).toHaveBeenCalledOnce())
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
  rendered.unmount(); mocks.fetch.mockResolvedValue({ success: true, data: { ...self, canEdit: false } })
  render(<SelfMfa />); await screen.findByText('残り 2 / 8 個')
  expect(screen.queryByRole('button', { name: '回復コードを作り直す' })).toBeNull()
})
