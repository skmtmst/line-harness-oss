// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ create: vi.fn(), version: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: {
  conversions: { definitions: async () => ({ success: true, data: { items: [{ id: 'point-1', name: '購入' }] } }) },
  tags: { list: async () => ({ success: true, data: [] }) },
  forms: { list: async () => ({ success: true, data: [] }) },
  analytics: { v6Funnels: { create: net.create, createVersion: net.version } },
} }))
import FunnelFormV8 from './funnel-form'

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  net.create.mockReset().mockResolvedValue({ success: false, error: '通信を確認してください' })
  net.version.mockReset()
})
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

it('入力不足は欄だけで知らせ、名前→段の名前→条件へ移り、保存しない', async () => {
  render(<FunnelFormV8 accountId="account-1" onCancel={() => {}} onCreated={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '作る', exact: true }))
  const name = screen.getByLabelText('名前', { exact: true })
  await waitFor(() => expect(document.activeElement).toBe(name))
  expect(name.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getAllByText('名前を入力してください')).toHaveLength(1)
  expect(document.querySelector('[data-design-part="dialog"] > [role="alert"]')).toBeNull()
  fireEvent.change(name, { target: { value: '購入まで' } })
  fireEvent.click(screen.getByRole('button', { name: '作る', exact: true }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('段1の名前')))
  fireEvent.change(screen.getByLabelText('段1の名前'), { target: { value: '友だち追加' } })
  fireEvent.change(screen.getByLabelText('段2の名前'), { target: { value: '購入' } })
  fireEvent.click(screen.getByRole('button', { name: '作る', exact: true }))
  const choice = screen.getByRole('button', { name: '2段目で何をしたら進むか' })
  await waitFor(() => expect(document.activeElement).toBe(choice))
  expect(choice.getAttribute('aria-invalid')).toBe('true')
  expect(net.create).not.toHaveBeenCalled()
})

it('入力が揃えば同じ条件で保存し、通信の失敗は窓の帯で知らせる', async () => {
  render(<FunnelFormV8 accountId="account-1" presetConversion={{ id: 'point-1', name: '購入' }} onCancel={() => {}} onCreated={() => {}} />)
  fireEvent.change(screen.getByLabelText('名前', { exact: true }), { target: { value: '購入まで' } })
  fireEvent.change(screen.getByLabelText('段1の名前'), { target: { value: '友だち追加' } })
  fireEvent.click(screen.getByRole('button', { name: '作る', exact: true }))
  await waitFor(() => expect(net.create).toHaveBeenCalledWith('account-1', {
    name: '購入まで', windowDays: 30,
    steps: [{ label: '友だち追加', kind: 'friend_add', match: {} }, { label: '購入', kind: 'conversion', match: { conversionPointId: 'point-1' } }],
  }))
  expect((await screen.findByRole('alert')).textContent).toContain('通信を確認してください')
  expect(document.querySelector('input[aria-invalid="true"]')).toBeNull()
})
