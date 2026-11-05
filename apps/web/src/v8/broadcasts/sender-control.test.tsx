// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), list: vi.fn(), allowed: true, session: null as null | { impersonation: object } }))
vi.mock('@/lib/api/features/broadcast-corrections', () => ({ broadcastCorrectionApi: { getSender: mocks.get, setSender: mocks.set } }))
vi.mock('@/lib/api/helpers/gap1', () => ({ lineSenderApi: { list: mocks.list } }))
vi.mock('@/lib/session-snapshot', () => ({ readPermissionSessionSnapshot: () => mocks.session }))
vi.mock('@/lib/staff-identity-state', () => ({ readStaffIdentity: () => null, staffIdentityGeneration: () => 0 }))
vi.mock('./write-access', () => ({ canEditBroadcastNow: () => mocks.allowed }))
import { BroadcastSenderControl } from './sender-control'

beforeEach(() => {
  vi.clearAllMocks(); mocks.allowed = true; mocks.session = null
  mocks.get.mockResolvedValue({ success: true, data: { senderId: null, sender: null, sentByStaffName: null, version: 1, testMode: true } })
  mocks.list.mockResolvedValue({ success: true, data: [{ id: 'sender', name: 'お知らせ係', status: 'active' }] })
  mocks.set.mockResolvedValue({ success: true, data: { version: 2 } })
})
afterEach(cleanup)

it('送り手を選び版とともに保存して読み直す', async () => {
  render(<BroadcastSenderControl id="draft" accountId="account" isDraft allowed />)
  fireEvent.click(await screen.findByRole('button', { name: '送り手' }))
  fireEvent.click(within(await screen.findByRole('option', { name: 'お知らせ係' })).getByRole('button'))
  fireEvent.click(screen.getByRole('button', { name: '送り手を保存' }))
  await waitFor(() => expect(mocks.set).toHaveBeenCalledWith('draft', 'sender', 1))
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2))
})

it('閲覧のみは灰色で理由を伝え、押しても保存しない', async () => {
  mocks.allowed = false
  render(<BroadcastSenderControl id="draft" accountId="account" isDraft allowed={false} lockedReason="閲覧のみのため変更できません。" />)
  const button = await screen.findByRole('button', { name: '送り手を保存' })
  expect(button.getAttribute('aria-disabled')).toBe('true'); expect(button.hasAttribute('data-permission-locked')).toBe(true)
  fireEvent.focus(button); expect(screen.getByRole('tooltip').textContent).toContain('閲覧のみ')
  fireEvent.click(button); expect(mocks.set).not.toHaveBeenCalled()
})

it('読取に失敗したら店の名前と決めつけず、読み直せる', async () => {
  mocks.get.mockRejectedValueOnce(new Error('offline'))
  render(<BroadcastSenderControl id="draft" accountId="account" isDraft allowed />)
  expect(await screen.findByText('送り手を読み込めませんでした。')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '読み直す' }))
  expect(await screen.findByRole('button', { name: '送り手' })).toBeTruthy()
})

it('同じ送り手でも名前の控えが古ければ保存し直せる', async () => {
  mocks.get.mockResolvedValue({ success: true, data: { senderId: 'sender', sender: { name: '古い名前' }, senderStale: true, sentByStaffName: null, version: 3, testMode: true } })
  render(<BroadcastSenderControl id="draft" accountId="account" isDraft allowed />)
  expect(await screen.findByText('送り手の名前が変わりました。選び直してください。')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '送り手を保存' }))
  await waitFor(() => expect(mocks.set).toHaveBeenCalledWith('draft', 'sender', 3))
})
