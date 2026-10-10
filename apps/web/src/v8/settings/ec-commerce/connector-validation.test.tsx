// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fx = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/ec-commerce', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: () => ({ leaveTarget: null, confirmLeave: vi.fn(), cancelLeave: vi.fn() }) }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, ecCommerce: { ...actual.api.ecCommerce, connector: fx.read, updateConnector: fx.save } } }
})
import EcConnector from './connector'

beforeEach(() => {
  fx.read.mockResolvedValue({ success: true, data: {
    configured: true, connector: { provider: 'shopify', shopDomain: 'shop.nen.example', status: 'connected', secretConfigured: true, secretLastFour: '1234', eventTypes: ['ec.order.confirmed'], identityRules: ['email'], version: 1 },
    health: { today: 1, last30Days: 1, failed: 0, lastSucceededAt: null, lastReceivedAt: null },
  } })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('入力不備は欄の赤枠と理由で知らせ、最初の欄へ移動する', async () => {
  render(<EcConnector accountId="account-a" />)
  const domain = await screen.findByLabelText('ショップのアドレス')
  fireEvent.change(domain, { target: { value: 'https://shop.nen.example/' } })
  fireEvent.click(screen.getByRole('button', { name: '設定を保存する' }))
  expect(domain.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(domain)
  expect(screen.getAllByText(/ショップのドメインを入れてください/)).toHaveLength(1)
  expect(fx.save).not.toHaveBeenCalled()
  fireEvent.change(domain, { target: { value: 'shop.nen.example' } })
  fireEvent.click(screen.getByRole('button', { name: '差し替える' }))
  const secret = screen.getByLabelText('つなぐための鍵')
  fireEvent.change(secret, { target: { value: 'short' } })
  fireEvent.click(screen.getByRole('button', { name: '設定を保存する' }))
  expect(secret.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(secret)
  expect(screen.getAllByText('32文字以上の鍵を入れてください。')).toHaveLength(1)
  expect(fx.save).not.toHaveBeenCalled()
})

it('保存の通信失敗は上の帯へ出し、入力した鍵は残す', async () => {
  fx.save.mockRejectedValue(new Error('offline'))
  render(<EcConnector accountId="account-a" />)
  await screen.findByLabelText('ショップのアドレス')
  fireEvent.click(screen.getByRole('button', { name: '差し替える' }))
  const secret = screen.getByLabelText('つなぐための鍵') as HTMLInputElement
  const value = 'a'.repeat(32)
  fireEvent.change(secret, { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: '設定を保存する' }))
  await waitFor(() => expect(fx.save).toHaveBeenCalled())
  expect((await screen.findByRole('alert')).textContent).toContain('通信の状態を確認')
  expect(secret.value).toBe(value)
  expect(secret.getAttribute('aria-invalid')).not.toBe('true')
})

it('保存が競合しても入力を残し、比べるだけでは入力を捨てない', async () => {
  const { ApiError } = await import('@/lib/api')
  fx.save.mockRejectedValue(new ApiError(409, 'version_conflict'))
  render(<EcConnector accountId="account-a" />)
  const domain = await screen.findByLabelText('ショップのアドレス') as HTMLInputElement
  fireEvent.change(domain, { target: { value: 'mine.nen.example' } })
  fireEvent.click(screen.getByRole('button', { name: '設定を保存する' }))
  await screen.findByRole('button', { name: '違いを比べる' })
  expect(domain.value).toBe('mine.nen.example')
  expect(fx.read).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '違いを比べる' }))
  await screen.findByRole('dialog', { name: '最新の保存と比べる' })
  expect(domain.value).toBe('mine.nen.example')
})
