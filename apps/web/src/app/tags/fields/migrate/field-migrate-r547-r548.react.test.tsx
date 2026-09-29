// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * R548: 移行成功後の結果取得失敗を画面が黙殺し再実行を提示する。
 * R547: 移行の最終集計失敗で画面が無期限の処理中になる。
 *
 * 実行POSTを受け付けたのに結果が無い間は「未確認」と出し、
 * 「移行を実行する」には戻さず、同じrunの再取得・再開へつなげる。
 */

const fixture = vi.hoisted(() => ({
  fieldsList: vi.fn(),
  fieldsCreate: vi.fn(),
  migrationPreview: vi.fn(),
  migrationExecute: vi.fn(),
  migrationRun: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('id=source-1'),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1' }),
}))
vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready' as const, features: null, enabled: () => true }),
}))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    friendFields: {
      list: fixture.fieldsList,
      create: fixture.fieldsCreate,
      migrationPreview: fixture.migrationPreview,
      migrationExecute: fixture.migrationExecute,
      migrationRun: fixture.migrationRun,
    },
    featureSettings: {
      visibility: () => Promise.resolve({ success: true, data: { features: {} } }),
    },
  },
  describeSaveFailure: () => '保存できませんでした。接続を確かめて、もう一度お試しください。',
}))

import MigrateFriendFieldPage from './page'

const SOURCE = {
  id: 'source-1',
  folderId: null,
  name: '旧項目',
  fieldKey: 'old_key',
  type: 'text',
  options: null,
  defaultValue: null,
  source: 'manual',
  ecFieldPath: null,
  ecIsMaster: false,
  isPersonal: false,
  isStarred: false,
  displayOrder: 0,
  createdAt: '2026-09-01T00:00:00+09:00',
  updatedAt: '2026-09-01T00:00:00+09:00',
  version: 1,
}

const CREATED = { ...SOURCE, id: 'ff-new', name: '旧項目（新）', fieldKey: 'old_key_new' }

const PREVIEW = {
  summary: { total: 2, convertible: 2, review: 0, invalid: 0 },
  rows: [],
  usageTargets: [],
  runId: 'run-0',
  previewToken: 'tok-1',
  previewExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
}

function runData(status: string) {
  return {
    runId: 'run-9',
    sourceFieldId: 'source-1',
    targetFieldId: 'ff-new',
    status,
    summary: { total: 2, convertible: 2, review: 0, invalid: 0, processed: 2, succeeded: 2, failed: 0 },
    usageTargets: [],
    rows: [],
    previewExpiresAt: null,
    rollbackDeadline: null,
    error: null,
    createdAt: '2026-09-01T00:00:00+09:00',
    updatedAt: '2026-09-01T00:00:00+09:00',
  }
}

function previewButtons(): HTMLButtonElement[] {
  return screen.getAllByRole('button', { name: '項目を作成して事前確認' }) as HTMLButtonElement[]
}

function executeButton(): HTMLButtonElement | null {
  return screen.queryByRole('button', { name: '移行を実行する' }) as HTMLButtonElement | null
}

beforeEach(() => {
  fixture.fieldsList.mockResolvedValue({ success: true, data: [SOURCE] })
  fixture.fieldsCreate.mockResolvedValue({ success: true, data: CREATED })
  fixture.migrationPreview.mockResolvedValue({ success: true, data: PREVIEW })
  fixture.migrationExecute.mockResolvedValue({ success: true, data: { runId: 'run-9' } })
  fixture.migrationRun.mockResolvedValue({ success: true, data: runData('succeeded') })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

/** 事前確認まで進め、実行ボタンを押せる状態にする */
async function confirmReady() {
  render(<MigrateFriendFieldPage />)
  await waitFor(() => expect(previewButtons()[0].disabled).toBe(false))
  fireEvent.click(previewButtons()[0])
  await waitFor(() => expect(executeButton()).not.toBeNull())
}

describe('R548 結果の取得失敗は黙殺せず同じrunへ戻す', () => {
  it('POST成功後のGET失敗で未確認を出し、実行ボタンは戻さない', async () => {
    await confirmReady()
    fixture.migrationRun.mockRejectedValueOnce(new Error('network down'))
    fireEvent.click(executeButton()!)
    await screen.findAllByText('移行の結果を確認できませんでした。通信を確かめて、結果を確認し直してください。')
    // 結果もエラーも無く「移行を実行する」に戻ってはいけない。
    expect(executeButton()).toBeNull()
    expect(screen.queryByRole('button', { name: '確認をやり直す' })).toBeNull()
    expect(screen.getByRole('button', { name: '結果を確認する' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '続きから再開する' })).not.toBeNull()
  })

  it('同じrunの再取得で完了状態へ戻れる', async () => {
    await confirmReady()
    fixture.migrationRun.mockRejectedValueOnce(new Error('network down'))
    fireEvent.click(executeButton()!)
    await screen.findAllByText('移行の結果を確認できませんでした。通信を確かめて、結果を確認し直してください。')

    fixture.migrationRun.mockResolvedValueOnce({ success: true, data: runData('succeeded') })
    fireEvent.click(screen.getByRole('button', { name: '結果を確認する' }))
    await screen.findAllByText('移行が完了しました')
    expect(screen.queryByRole('button', { name: '結果を確認する' })).toBeNull()
    expect(screen.queryByRole('button', { name: '続きから再開する' })).toBeNull()
  })
})

describe('R547 止まった実行は続きから再開できる', () => {
  it('再開は新しい要求キーで送り、完了したら結果へ戻る', async () => {
    await confirmReady()
    fixture.migrationRun.mockRejectedValueOnce(new Error('network down'))
    fireEvent.click(executeButton()!)
    await screen.findAllByText('移行の結果を確認できませんでした。通信を確かめて、結果を確認し直してください。')

    fixture.migrationRun.mockResolvedValueOnce({ success: true, data: runData('succeeded') })
    fireEvent.click(screen.getByRole('button', { name: '続きから再開する' }))
    await screen.findAllByText('移行が完了しました')
    expect(fixture.migrationExecute).toHaveBeenCalledTimes(2)
    const firstKey = fixture.migrationExecute.mock.calls[0][3] as string
    const secondKey = fixture.migrationExecute.mock.calls[1][3] as string
    expect(typeof firstKey).toBe('string')
    expect(secondKey).not.toBe(firstKey)
  })

  it('実行中のまま上限に達したら止まった旨を出し、処理中のままにしない', async () => {
    vi.useFakeTimers()
    render(<MigrateFriendFieldPage />)
    const tick = async (ms: number) => {
      await act(async () => { vi.advanceTimersByTime(ms) })
      await act(async () => {})
    }
    await tick(0)
    await tick(0)
    fireEvent.click(previewButtons()[0])
    for (let i = 0; i < 10 && executeButton() === null; i++) {
      await tick(0)
    }
    expect(executeButton()).not.toBeNull()
    fixture.migrationRun.mockResolvedValue({ success: true, data: runData('running') })
    fireEvent.click(executeButton()!)
    await tick(0)
    await tick(0)
    for (let i = 0; i < 22; i++) {
      await tick(2000)
    }
    await tick(0)
    await tick(0)
    // 偽タイマー下では waitFor が進まないため、確定 tick 後に同期で見る。
    expect(
      screen.getAllByText('まだ実行中です。結果の再取得か、止まっている場合の再開ができます。').length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: '結果を確認する' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '続きから再開する' })).not.toBeNull()
    expect(executeButton()).toBeNull()
  })
})
