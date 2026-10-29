// @vitest-environment happy-dom
/*
 * 監査 WEB201/202：送れなかったものの数のマス。
 * - 201：読み込んだページだけから数えたときは「このページの n件から」と書く。期間を言い切らない
 * - 202：「メールで送った」を送れなかった一覧から数えない
 */
import React from 'react'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/line-notifications',
}))
const mutation = vi.hoisted(() => vi.fn())
const availability = vi.hoisted(() => ({ retry: true }))
const identity = vi.hoisted(() => ({ role: 'owner', readOnly: false, roleBundle: undefined as string | undefined }))
beforeEach(() => { availability.retry = true; mutation.mockReset(); identity.role = 'owner'; identity.readOnly = false; identity.roleBundle = undefined })
const run = vi.hoisted(() => (id: string, channel: 'line' | 'email', reason: string) => ({
  id, recipientType: 'customer', notificationName: '注文', source: 'ec', sourceEventId: 'e', friendId: 'f', friendName: '田中',
  orderNumber: 'A-1', channel, status: 'failed', reason, receivedAt: '2026-10-01T00:00:00Z', acceptedAt: null, attemptCount: 1,
  retryAvailable: availability.retry, recordVersion: 7, nextRetryAt: null, clickedAt: null, version: 1, executionMode: 'automatic',
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  const page = {
    success: true,
    data: { items: [run('r1', 'line', 'ブロックされていました'), run('r2', 'email', 'メールが届きませんでした')], summary: { failed: 57 }, coverage: { source: 'notification_delivery_ledger' } },
    pagination: { total: 57, limit: 20, offset: 0 },
  }
  return {
    ...actual,
    fetchApi: mutation,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: identity }) },
      lineNotifications: { ...actual.api.lineNotifications, deliveries: async () => page, notificationRuns: async () => page, retryDelivery: mutation },
      ecCommerce: { ...actual.api.ecCommerce, notificationRuns: async () => page },
    },
  }
})

import RunsTab from './runs-tab'
afterEach(cleanup)

test('ページだけから数えたと書き、メールで送ったは数えない', async () => {
  render(<RunsTab lineAccountId="acc" mode="failures" />)
  await waitFor(() => expect(screen.getByText(/このページの2件から・対応不要/)).toBeTruthy())
  expect(screen.queryByText('この7日')).toBeNull()
  expect(screen.getByText('57件中 1〜20件')).toBeTruthy()
  expect(screen.getAllByTitle('田中')).toHaveLength(2)
  expect(screen.getAllByTitle('顧客・A-1')).toHaveLength(2)
  expect(screen.getAllByTitle('1回・—')).toHaveLength(2)
  expect(screen.getByText('お知らせの記録で見られます')).toBeTruthy()
  const blocked = screen.getByText('ブロック').closest('[data-kpi-presentation]')
  expect(blocked).not.toBeNull()
  expect(blocked!.querySelector('svg.lucide-user-x')).not.toBeNull()
})

test('ページ内で絞り込んでも全体の件数と検索範囲の案内を保つ', async () => {
  render(<RunsTab lineAccountId="acc" mode="failures" />)
  await screen.findByText('57件中 1〜20件')
  fireEvent.change(screen.getByRole('searchbox', { name: 'お客様の名前・注文番号で探す' }), { target: { value: '存在しない通知' } })
  expect(await screen.findByText('条件に合う記録はありません')).toBeTruthy()
  expect(screen.getByText('57件中 1〜20件')).toBeTruthy()
  expect(screen.getByText('個人の既読は見られません。試行回数と次の再試行予定は送信台帳の記録を表示します。検索と絞り込みは表示中のページの中だけに効きます。')).toBeTruthy()
})

test.each([
  [{ role: 'owner' }, true, true], [{ role: 'admin' }, false, true], [{ role: 'staff' }, false, false],
  [{ role: 'viewer' }, false, false], [{ role: 'admin', readOnly: true }, false, false],
  [{ role: 'owner', roleBundle: 'view_only' }, false, false],
] as const)('詳細と操作を残し、送り直しと対応済みは現在の権限でロックする: %j', async (staff, retry, resolve) => {
  Object.assign(identity, staff)
  render(<RunsTab lineAccountId="acc" mode="failures" />)
  fireEvent.click((await screen.findAllByRole('button', { name: '注文' }))[0])
  await screen.findByText('記録の詳細')
  expect(screen.getByRole('button', { name: '送信を再試行する' }).getAttribute('aria-disabled') === 'true').toBe(!retry)
  expect(screen.getByRole('button', { name: '対応済みにする' }).getAttribute('aria-disabled') === 'true').toBe(!resolve)
  if (!retry) fireEvent.click(screen.getByRole('button', { name: '送信を再試行する' }))
  if (!resolve) fireEvent.click(screen.getByRole('button', { name: '対応済みにする' }))
  expect(mutation).not.toHaveBeenCalled()
})


test.each([
  { role: 'owner', retryAvailable: true },
  { role: 'viewer', retryAvailable: true },
  { role: 'owner', retryAvailable: false },
  { role: 'viewer', retryAvailable: false },
])('台帳の再試行可否と現在の権限を描画と送信で確かめる: %j', async ({ role, retryAvailable }) => {
  identity.role = role
  availability.retry = retryAvailable
  render(<RunsTab lineAccountId="acc" mode="failures" />)
  fireEvent.click((await screen.findAllByRole('button', { name: '注文' }))[0])
  await screen.findByText('記録の詳細')
  const retry = screen.queryByRole('button', { name: '送信を再試行する' })
  if (!retryAvailable) {
    expect(retry).toBeNull()
    expect(mutation).not.toHaveBeenCalled()
    return
  }
  expect(retry).not.toBeNull()
  if (role === 'viewer') {
    expect(retry!.getAttribute('aria-disabled')).toBe('true')
    expect(retry!.hasAttribute('data-permission-locked')).toBe(true)
    const reason = (retry!.getAttribute('aria-describedby') ?? '').split(/\s+/)
      .map(id => document.getElementById(id)?.textContent ?? '').join(' ')
    expect(reason).toMatch(/権限|閲覧|オーナー|店長/)
    fireEvent.focus(retry!)
    fireEvent.click(retry!)
    fireEvent.keyDown(retry!, { key: 'Enter' })
    expect(mutation).not.toHaveBeenCalled()
  } else {
    expect(retry!.getAttribute('aria-disabled')).not.toBe('true')
    fireEvent.click(retry!)
    await waitFor(() => expect(mutation).toHaveBeenCalledWith('r1', {
      lineAccountId: 'acc', expectedVersion: 7,
    }))
  }
})
