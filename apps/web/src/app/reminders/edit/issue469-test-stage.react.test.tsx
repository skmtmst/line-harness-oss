// @vitest-environment happy-dom
/*
 * N-070: テスト送信の画面が、送る前に送信先を出し、未設定・届かない・
 * 読み込み失敗・成功を分け、同じ画面からやり直せることを確かめる。
 * 遅い応答が別リマインダの送信先で上書きしないことも固定する。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReminderDraftVersion } from '@line-crm/shared'

const apiMocks = vi.hoisted(() => ({
  getDraft: vi.fn(),
  getTestRecipient: vi.fn(),
  testDraft: vi.fn(),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/api', () => ({ api: { reminders: apiMocks } }))

import { Issue469ReminderTestStage } from './issue469-reminder-screens'

const DRAFT: ReminderDraftVersion = {
  reminderId: 'rem-1',
  versionId: 'ver-1',
  versionNumber: 1,
  status: 'draft',
  settings: {
    name: '予約前のお知らせ',
    description: null,
    lineAccountId: 'account-1',
    triggerType: 'booking',
    deliveryMode: 'time',
    triggerFieldId: null,
    triggerEventId: null,
    repeatYearly: false,
    triggerOffsetMinutes: null,
    sendAtTime: null,
    targetTagId: null,
    folderId: null,
    stopConditions: { bookingCancelled: true, supportMarkCompleted: false, daysAfterTarget: null, friendBlocked: true },
    steps: [
      { stableStepId: 'step-1', offsetMinutes: 0, messageType: 'text', messageContent: '本文です', offsetDays: -1, sendAtTime: '18:00', templateId: null },
    ],
  },
  lastTestStatus: null,
  lastTestedAt: null,
  publishedAt: null,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function ok<T>(data: T) {
  return Promise.resolve({ success: true as const, data })
}

async function flush() {
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  apiMocks.getDraft.mockReset()
  apiMocks.getTestRecipient.mockReset()
  apiMocks.testDraft.mockReset()
})
afterEach(cleanup)

describe('リマインダ テスト送信段 (N-070)', () => {
  it('送る前に設定済みの送信先を出す', async () => {
    apiMocks.getDraft.mockReturnValue(ok(DRAFT))
    apiMocks.getTestRecipient.mockReturnValue(ok({ state: 'ready', recipient: { id: 'f1', displayName: '田中 太郎', pictureUrl: null } }))
    render(<Issue469ReminderTestStage reminderId="rem-1" />)
    await flush()
    expect(screen.getAllByText('田中 太郎').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('テスト送信後に表示')).toBeNull()
    expect(apiMocks.getTestRecipient).toHaveBeenCalledWith('rem-1')
  })

  it('未設定のとき設定画面への導線を出し、再確認で読み直す', async () => {
    apiMocks.getDraft.mockReturnValue(ok(DRAFT))
    apiMocks.getTestRecipient.mockReturnValueOnce(ok({ state: 'unset', recipient: null }))
    render(<Issue469ReminderTestStage reminderId="rem-1" />)
    await flush()
    expect(screen.getAllByText('未設定').length).toBeGreaterThanOrEqual(1)
    const link = screen.getByText('アカウント設定').closest('a')
    expect(link?.getAttribute('href')).toBe('/accounts/detail?id=account-1')

    // 設定して戻ってきたあと、同じ画面の「送信先を再確認」で読み直せる。
    apiMocks.getTestRecipient.mockReturnValueOnce(ok({ state: 'ready', recipient: { id: 'f1', displayName: '田中 太郎', pictureUrl: null } }))
    fireEvent.click(screen.getByRole('button', { name: '送信先を再確認' }))
    await flush()
    expect(apiMocks.getTestRecipient).toHaveBeenCalledTimes(2)
    expect(screen.getAllByText('田中 太郎').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('未設定')).toBeNull()
  })

  it('読み込み失敗は未設定と区別し、再確認でやり直せる', async () => {
    apiMocks.getDraft.mockReturnValue(ok(DRAFT))
    apiMocks.getTestRecipient.mockReturnValueOnce(Promise.resolve({ success: false, error: 'server error' }))
    render(<Issue469ReminderTestStage reminderId="rem-1" />)
    await flush()
    expect(screen.getAllByText('読み込めませんでした').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('未設定')).toBeNull()

    apiMocks.getTestRecipient.mockReturnValueOnce(ok({ state: 'ready', recipient: { id: 'f1', displayName: '田中 太郎', pictureUrl: null } }))
    fireEvent.click(screen.getByRole('button', { name: '送信先を再確認' }))
    await flush()
    expect(screen.getAllByText('田中 太郎').length).toBeGreaterThanOrEqual(1)
  })

  it('送信が送信先未設定で失敗したら、その旨と案内を出して同じ画面で再試行できる', async () => {
    apiMocks.getDraft.mockReturnValue(ok(DRAFT))
    apiMocks.getTestRecipient.mockReturnValue(ok({ state: 'unset', recipient: null }))
    apiMocks.testDraft.mockReturnValue(Promise.resolve({
      success: false,
      error: 'テスト送信先を設定してください',
      code: 'TEST_RECIPIENT_NOT_CONFIGURED',
    }))
    render(<Issue469ReminderTestStage reminderId="rem-1" />)
    await flush()

    // 確認ダイアログから送信 → 422 未設定
    fireEvent.click(screen.getAllByRole('button', { name: 'テスト送信' })[0])
    await flush()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'テスト送信' }))
    await flush()
    expect(screen.getAllByText('テスト送信先を設定してください').length).toBeGreaterThanOrEqual(1)
    // 送信先起因の失敗は送信先の表示も最新へ揃え直す（再読み込みされる）。
    expect(apiMocks.getTestRecipient.mock.calls.length).toBeGreaterThanOrEqual(2)

    // 設定後に同じ画面から再試行 → 成功。
    apiMocks.getTestRecipient.mockReturnValue(ok({ state: 'ready', recipient: { id: 'f1', displayName: '田中 太郎', pictureUrl: null } }))
    apiMocks.testDraft.mockReturnValue(ok({ sent: 1, recipientName: '田中 太郎', replayed: false, requestId: 'r1', testedAt: '2026-09-10T03:00:00.000Z' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'テスト送信' })[0])
    await flush()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'テスト送信' }))
    await flush()
    expect(screen.getAllByText('田中 太郎').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/テスト済み/).length).toBeGreaterThanOrEqual(1)
  })

  it('遅れて届いた別リマインダの送信先で画面を上書きしない', async () => {
    const draftB: ReminderDraftVersion = { ...DRAFT, reminderId: 'rem-2' }
    apiMocks.getDraft.mockImplementation((id: string) => ok(id === 'rem-1' ? DRAFT : draftB))
    const slowA = deferred<{ success: true; data: { state: string; recipient: { id: string; displayName: string; pictureUrl: null } } }>()
    apiMocks.getTestRecipient.mockImplementation((id: string) =>
      id === 'rem-1' ? slowA.promise : ok({ state: 'ready', recipient: { id: 'f9', displayName: '別アカウントの人', pictureUrl: null } }),
    )

    const { rerender } = render(<Issue469ReminderTestStage reminderId="rem-1" />)
    // rem-1 の応答が来る前に rem-2 へ切り替える。
    rerender(<Issue469ReminderTestStage reminderId="rem-2" />)
    await flush()
    expect(screen.getAllByText('別アカウントの人').length).toBeGreaterThanOrEqual(1)

    // 遅れて届いた rem-1 の応答は捨てる。
    await act(async () => {
      slowA.resolve({ success: true, data: { state: 'ready', recipient: { id: 'f1', displayName: '古い送信先', pictureUrl: null } } })
      await Promise.resolve()
    })
    expect(screen.queryByText('古い送信先')).toBeNull()
    expect(screen.getAllByText('別アカウントの人').length).toBeGreaterThanOrEqual(1)
  })
})
