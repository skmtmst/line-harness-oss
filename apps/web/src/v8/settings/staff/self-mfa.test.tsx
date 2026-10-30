// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SelfMfa from './self-mfa'
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), gate: vi.fn() }))
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), fetchApi: mocks.fetch }))
vi.mock('@/components/step-up-prompt', () => ({ useStepUpGate: () => ({ gate: mocks.gate, prompt: null }) }))
beforeEach(() => { mocks.fetch.mockReset(); mocks.gate.mockReset() }); afterEach(cleanup)
const self = { staffId: 'fixture-self', enabledAt: '2026-10-12T10:00:00Z', remaining: 2, canEdit: true, notice: null }

it('keeps authenticator management without showing recovery-code controls in the user panel', async () => {
  mocks.fetch.mockResolvedValue({ success: true, data: self })
  render(<SelfMfa compact />)
  expect(await screen.findByText(/登録済み/)).toBeTruthy()
  expect(screen.getByRole('button', { name: '登録し直す' })).toBeTruthy()
  expect(screen.queryByText(/回復コード/)).toBeNull()
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
})

it('requires the existing step-up check before starting authenticator re-enrollment', async () => {
  mocks.fetch.mockResolvedValue({ success: true, data: self })
  mocks.gate.mockResolvedValue(null)
  render(<SelfMfa compact />)
  fireEvent.click(await screen.findByRole('button', { name: '登録し直す' }))
  await waitFor(() => expect(mocks.gate).toHaveBeenCalledOnce())
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
})
