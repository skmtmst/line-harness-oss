// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  routerPush: vi.fn(),
  fieldsList: vi.fn(),
  fieldsCreate: vi.fn(),
  migrationPreview: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush }),
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

const CREATED = {
  ...SOURCE,
  id: 'ff-new',
  name: '旧項目（新）',
  fieldKey: 'old_key_new',
}

function previewButton(): HTMLButtonElement {
  // 本文と追従バーの2か所に同じボタンがある。どちらも同じ操作を呼ぶ。
  return screen.getAllByRole('button', { name: '項目を作って事前確認' })[0] as HTMLButtonElement
}

async function waitForReady() {
  await waitFor(() => expect(previewButton().disabled).toBe(false))
  /*
    R519-flake: ボタンが見えても、初期取得で入った名前・差し込み名に
    反応する受動effect（要求キーの作り直し）がまだ流れる前がある。
    押す前に流して、1回目と2回目の押下を同じ世代のキーにする。
    CI run36668283000 はここを待たずに押し、2回目だけ新しいキーになった。
  */
  await act(async () => {})
}

beforeEach(() => {
  fixture.fieldsList.mockResolvedValue({ success: true, data: [SOURCE] })
  fixture.fieldsCreate.mockResolvedValue({ success: true, data: CREATED })
  fixture.migrationPreview.mockResolvedValue({
    success: true,
    data: {
      source: SOURCE,
      summary: { total: 0, convertible: 0, review: 0, invalid: 0 },
      rows: [],
      usageTargets: [],
      runId: null,
      previewToken: 'tok',
      previewExpiresAt: null,
    },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/*
 * R519: 移行先の作成応答を失っても、再試行で作成済みへ戻り事前確認へ進める。
 * 以前は作り直すたびに新しい要求キーで送り、同じ差し込み名の409で止まった。
 */
describe('R519 移行先の作成応答を失っても復帰する', () => {
  it('入力を変えない再試行は同じ要求キーで送り、事前確認へ進める', async () => {
    render(<MigrateFriendFieldPage />)
    await waitForReady()

    fixture.fieldsCreate.mockRejectedValueOnce(new Error('response lost'))
    fireEvent.click(previewButton())
    await screen.findByText('保存できませんでした。接続を確かめて、もう一度お試しください。')
    expect(fixture.fieldsCreate).toHaveBeenCalledTimes(1)
    const firstKey = fixture.fieldsCreate.mock.calls[0][2] as string
    expect(fixture.migrationPreview).not.toHaveBeenCalled()

    fireEvent.click(previewButton())
    await waitFor(() => expect(fixture.migrationPreview).toHaveBeenCalledTimes(1))
    expect(fixture.fieldsCreate).toHaveBeenCalledTimes(2)
    // 同じ移行先の作り直しは同じ要求キーで送る（二重に作らない）。
    expect(fixture.fieldsCreate.mock.calls[1][2]).toBe(firstKey)
    expect(fixture.migrationPreview).toHaveBeenCalledWith(
      'source-1', 'account-1', { targetFieldId: 'ff-new' },
    )
    // 事前確認の描画まで進む。不完全な応答のままでは画面が落ち、ここで赤になる。
    await screen.findByText('確認が必要な値はありません。')
  })

  it('差し込み名の重複では同一内容の作成済みを取り直して続ける', async () => {
    render(<MigrateFriendFieldPage />)
    await waitForReady()

    // 要求キーが変わった後の再送で一意制約に当たった想定。
    fixture.fieldsCreate.mockRejectedValueOnce({ status: 409 })
    fixture.fieldsList.mockResolvedValueOnce({ success: true, data: [SOURCE, CREATED] })
    fireEvent.click(previewButton())
    await waitFor(() => expect(fixture.migrationPreview).toHaveBeenCalledTimes(1))
    expect(fixture.migrationPreview).toHaveBeenCalledWith(
      'source-1', 'account-1', { targetFieldId: 'ff-new' },
    )
  })

  it('異なる内容の重複名は衝突として説明し、事前確認へ進めない', async () => {
    render(<MigrateFriendFieldPage />)
    await waitForReady()

    fixture.fieldsCreate.mockRejectedValueOnce({ status: 409 })
    fixture.fieldsList.mockResolvedValueOnce({
      success: true,
      data: [SOURCE, { ...CREATED, id: 'ff-x', name: '別の項目' }],
    })
    fireEvent.click(previewButton())
    await screen.findByText('同じ差し込み名「old_key_new」の別の項目があります。一覧を確認してください')
    expect(fixture.migrationPreview).not.toHaveBeenCalled()
  })
})
