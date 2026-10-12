// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import MfaPolicy from './mfa-policy'
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), gate: vi.fn() }))
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), fetchApi: mocks.fetch }))
vi.mock('@/components/step-up-prompt', () => ({ useStepUpGate: () => ({ gate: mocks.gate, prompt: null }) }))
beforeEach(() => { mocks.fetch.mockReset(); mocks.gate.mockReset() }); afterEach(cleanup)
it('Off requires the common confirmation flow and sends its one-use grant', async () => {
  mocks.fetch.mockResolvedValueOnce({ success: true, data: { required: true, canEdit: true } })
    .mockResolvedValueOnce({ success: true, data: { required: false, relogin: false } })
  mocks.gate.mockResolvedValue('fixture-grant')
  render(<MfaPolicy />)
  fireEvent.click(await screen.findByRole('switch', { name: 'ログインで二段階認証を必須にする' }))
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2))
  expect(mocks.gate).toHaveBeenCalledWith('auth.mfa.policy', '二段階認証の必須をオフにする')
  expect(mocks.fetch.mock.calls[1][1]).toMatchObject({ method: 'PUT', headers: { 'X-Step-Up-Token': 'fixture-grant' }, body: '{"required":false}' })
  await screen.findByText('パスワードやLINEだけで入れます。自分で登録した人には、確かめが出ます。')
})
it('cancelling confirmation retains On and sends no update', async () => {
  mocks.fetch.mockResolvedValueOnce({ success: true, data: { required: true, canEdit: true } }); mocks.gate.mockResolvedValue(null)
  render(<MfaPolicy />); fireEvent.click(await screen.findByRole('switch'))
  await waitFor(() => expect(mocks.gate).toHaveBeenCalledOnce())
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
})
it('a person without ownership sees the policy and has no switch', async () => {
  mocks.fetch.mockResolvedValueOnce({ success: true, data: { required: true, canEdit: false } })
  render(<MfaPolicy />); await screen.findByText('全員が、ログインのたびに認証アプリの6桁を入れます。まだ登録していない人は、次のログインで登録します。')
  expect(screen.queryByRole('switch')).toBeNull()
})
it('turning On warns that everyone must log in and permits initial enrollment', async () => {
  mocks.fetch.mockResolvedValueOnce({ success: true, data: { required: false, canEdit: true } })
  render(<MfaPolicy />); fireEvent.click(await screen.findByRole('switch'))
  await screen.findByRole('dialog')
  expect(screen.getByText(/まだ登録していない人は、次のログインで登録/)).toBeTruthy()
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
})

it('shows the missing-key notice and prevents enabling unavailable MFA', async () => {
  mocks.fetch.mockResolvedValueOnce({ success: true, data: { required: false, canEdit: true, configured: false, notice: '二段階認証の鍵が未設定のため、必須にできません', registered: 0, total: 2 } })
  render(<MfaPolicy />)
  await screen.findByText('二段階認証の鍵が未設定のため、必須にできません')
  expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('switch'))
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
})
