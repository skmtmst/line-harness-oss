// @vitest-environment happy-dom
/*
 * #708: すでに整理済みのタグで、archive の 409 already_archived を
 * 「失敗」ではなく「もう着いている」として見せることを、実物の React で確かめる。
 *
 * ソース文字列の検査では次が固定できない。happy-dom へ実物のタグ一覧を
 * マウントし、一覧の取得と archive・依存確認を実物の Promise で返してから、
 * 削除の確認窓を開いて押す。
 *
 *   - already_archived のとき、赤い失敗ではなく「すでに整理されています」が出る
 *   - そのとき一覧を読み直す（load がもう一度走る）
 *   - ほかの 409（版が古い等）は今までどおり失敗として出る
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  tagsList: null as null | ((...args: unknown[]) => Promise<unknown>),
  tagGroupsList: null as null | ((...args: unknown[]) => Promise<unknown>),
  dependencies: null as null | ((...args: unknown[]) => Promise<unknown>),
  archive: null as null | ((...args: unknown[]) => Promise<unknown>),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a' }),
}))

vi.mock('@/lib/api', () => {
  /** 本物と同じ形。画面は code で分岐する。 */
  class ApiError extends Error {
    status: number
    code: string | undefined
    data: unknown
    constructor(status: number, message?: string, code?: string, data?: unknown) {
      super(message || `API error: ${status}`)
      this.name = 'ApiError'
      this.status = status
      this.code = code
      this.data = data
    }
  }
  return {
    ApiError,
    api: {
      tags: {
        list: (...args: unknown[]) => fixture.tagsList!(...args),
        dependencies: (...args: unknown[]) => fixture.dependencies!(...args),
        archive: (...args: unknown[]) => fixture.archive!(...args),
        update: async () => ({ success: true, data: null }),
        setGroup: async () => ({ success: true, data: null }),
        reorder: async () => ({ success: true, data: null }),
      },
      tagGroups: {
        list: (...args: unknown[]) => fixture.tagGroupsList!(...args),
        update: async () => ({ success: true, data: null }),
        delete: async () => ({ success: true, data: null }),
      },
    },
  }
})

import TagsPageV4 from './tags-page-v4'

const TAGS = [
  {
    id: 'tag-archived',
    name: '旧キャンペーン',
    color: '#222222',
    createdAt: '2026-09-01T00:00:00Z',
    lineAccountId: 'account-a',
    status: 'archived',
  },
]

/** 削除確認の窓が読む依存の形。`impact.tag.version` と `revision` を返す。 */
function dependencies() {
  const counts = {
    broadcasts: 0, forms: 0, scenarios: 0, autoReplies: 0, savedSearches: 0,
    automations: 0, commonActions: 0, richMenus: 0, templates: 0, webinars: 0,
    reminders: 0, entryRoutes: 0, trackedLinks: 0, bookingMenus: 0,
    affiliateOffers: 0, events: 0, analyticsFunnels: 0, friendAddSettings: 0,
  }
  return {
    success: true,
    data: {
      tag: { id: 'tag-archived', name: '旧キャンペーン', version: 2, status: 'archived' },
      friendCount: 0,
      referenceCounts: counts,
      references: [],
      referenceItems: [],
      linkedActions: [],
      pendingRunCount: 0,
      mileageImpact: {
        configured: false, self: 0, referrer: 0, multiplier: null, priority: 0,
        reapplyPolicy: 'first_only', historyPreserved: true,
      },
      blockingReferenceCount: 0,
      canArchive: false,
      canDelete: true,
      checkedAt: '2026-09-11T00:00:00.000Z',
      revision: 'tag:tag-archived:v2:2026-09-11T00:00:00.000Z',
    },
  }
}

beforeEach(() => {
  fixture.tagsList = vi.fn(async () => ({ success: true, data: TAGS }))
  fixture.tagGroupsList = vi.fn(async () => ({ success: true, data: [] }))
  fixture.dependencies = vi.fn(async () => dependencies())
  fixture.archive = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** 一覧を描き、削除の確認窓を開く。 */
async function openDeleteDialog() {
  render(<TagsPageV4 accountId="account-a" />)
  const rowButton = await screen.findByRole('button', { name: '旧キャンペーン を削除' })
  await act(async () => { fireEvent.click(rowButton) })
  await screen.findByText('「旧キャンペーン」を削除しますか？')
  const input = screen.getByPlaceholderText('旧キャンペーン')
  await act(async () => { fireEvent.change(input, { target: { value: '旧キャンペーン' } }) })
}

describe('#708 整理済みタグの再 archive', () => {
  test('already_archived は赤い失敗ではなく「すでに整理されています」で出て、一覧を読み直す', async () => {
    const { ApiError } = await import('@/lib/api')
    fixture.archive = vi.fn(async () => {
      throw new ApiError(409, 'このタグはすでに整理されています。', 'already_archived')
    })
    await openDeleteDialog()

    const before = (fixture.tagsList as ReturnType<typeof vi.fn>).mock.calls.length
    const archiveButton = screen.getByRole('button', { name: 'このタグを削除する' })
    await act(async () => { fireEvent.click(archiveButton) })

    // 成功の通知として出る。赤い失敗（alertdialog の中の saveError）は出ない。
    expect(await screen.findByText('このタグはすでに整理されています。')).toBeTruthy()
    // 確認窓は閉じる。
    await waitFor(() => {
      expect(screen.queryByText('「旧キャンペーン」を削除しますか？')).toBeNull()
    })
    // 一覧を読み直す（望んだ状態にはもう着いているので、画面も最新にする）。
    await waitFor(() => {
      expect((fixture.tagsList as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before)
    })
  })

  test('ほかの 409 は今までどおり失敗として出る', async () => {
    const { ApiError } = await import('@/lib/api')
    fixture.archive = vi.fn(async () => {
      throw new ApiError(409, '別の人が先にタグを更新しました', 'version_conflict')
    })
    await openDeleteDialog()

    const archiveButton = screen.getByRole('button', { name: 'このタグを削除する' })
    await act(async () => { fireEvent.click(archiveButton) })

    expect(await screen.findByText('アーカイブできませんでした。影響を読み直して、もう一度お試しください。')).toBeTruthy()
    expect(screen.queryByText('このタグはすでに整理されています。')).toBeNull()
    // 失敗なので確認窓は開いたまま。
    expect(screen.getByText('「旧キャンペーン」を削除しますか？')).toBeTruthy()
  })
})
