// @vitest-environment happy-dom
/*
 * M955・M956: /tags/edit の主な状態（読み込み中・空・失敗・正常）と、
 * 保存の再送が同じ要求キーになること（応答消失後の再送で保存済みを返す）。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tag } from '@line-crm/shared'
import type { TagDefinition, TagDependencies } from '@/lib/api'
import type { TagEditorValues } from '@/components/friend-fields/tag-editor-v4'

const state = vi.hoisted(() => ({ search: 'id=t1' }))
const apiCalls = vi.hoisted(() => ({
  definition: vi.fn(),
  dependencies: vi.fn(),
  listGroups: vi.fn(),
  updateDefinition: vi.fn(),
  updateArchived: vi.fn(),
}))
const captured = vi.hoisted(() => ({
  onSave: undefined as unknown as (
    values: TagEditorValues,
    andAnother: boolean,
    applyRetroactive: boolean,
    previewToken?: string,
  ) => Promise<void>,
}))

const fakes = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  return { FakeApiError }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(state.search),
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'a1', selectedAccount: { name: 'A店' } }),
}))
vi.mock('@/lib/api', () => ({
  ApiError: fakes.FakeApiError,
  api: {
    tags: {
      definition: (...args: unknown[]) => apiCalls.definition(...args),
      dependencies: (...args: unknown[]) => apiCalls.dependencies(...args),
      updateDefinition: (...args: unknown[]) => apiCalls.updateDefinition(...args),
      updateArchivedNameAndDescription: (...args: unknown[]) => apiCalls.updateArchived(...args),
    },
    tagGroups: {
      list: (...args: unknown[]) => apiCalls.listGroups(...args),
    },
  },
}))
vi.mock('@/components/friend-fields/tag-editor-v4', () => ({
  definitionsForSave: (actions: unknown) => actions,
  linkedActionFromDefinition: (action: unknown) => action,
  default: (props: { onSave: typeof captured.onSave; notice?: React.ReactNode; error?: string }) => {
    captured.onSave = props.onSave
    return (
      <div data-testid="tag-editor">
        {props.notice ? <p>{props.notice}</p> : null}
        {props.error ? <p>{props.error}</p> : null}
      </div>
    )
  },
}))
vi.mock('@/components/shared/toast', () => ({
  notifyToast: vi.fn(),
}))

import Page from './page'

const tag = {
  id: 't1',
  name: '通常タグ',
  version: 1,
  status: 'active',
  manualAssignmentAllowed: true,
  friendCount: 1,
} as unknown as Tag
const definition = { tag, automation: null } as unknown as TagDefinition
const dependencies = { friendCount: 1 } as unknown as TagDependencies

function okFixtures() {
  apiCalls.definition.mockResolvedValue({ success: true, data: definition })
  apiCalls.dependencies.mockResolvedValue({ success: true, data: dependencies })
  apiCalls.listGroups.mockResolvedValue({ success: true, data: [] })
}

afterEach(() => {
  cleanup()
  state.search = 'id=t1'
  for (const fn of Object.values(apiCalls)) fn.mockReset()
  captured.onSave = undefined as unknown as typeof captured.onSave
})

const values = {
  name: '保存A',
  groupId: null,
  isStarred: false,
  reapplyPolicy: 'first_only',
  linked: false,
  rewardMiles: 0,
  referralRewardMiles: 0,
  multiplierBps: null,
  multiplierPriority: 0,
  actions: [],
  applyToExisting: false,
} as unknown as TagEditorValues

describe('/tags/edit の主な状態', () => {
  it('読み込み中は読み込み中と出す', () => {
    apiCalls.definition.mockReturnValue(new Promise(() => {}))
    apiCalls.dependencies.mockReturnValue(new Promise(() => {}))
    apiCalls.listGroups.mockReturnValue(new Promise(() => {}))
    render(<Page />)
    expect(screen.getByText('読み込み中…')).toBeTruthy()
  })

  it('id が無いときは一覧へ戻す案内を出す', async () => {
    state.search = ''
    render(<Page />)
    expect(await screen.findByText('編集するタグが指定されていません')).toBeTruthy()
    expect(apiCalls.definition).not.toHaveBeenCalled()
  })

  it('404 のときは見つからない案内を出す', async () => {
    okFixtures()
    apiCalls.definition.mockRejectedValue(new fakes.FakeApiError(404, 'Not found'))
    render(<Page />)
    expect(await screen.findByText('このタグは見つかりません')).toBeTruthy()
    expect(screen.queryByTestId('tag-editor')).toBeNull()
  })

  it('取得失敗のときは失敗と再取得の口を出す', async () => {
    okFixtures()
    apiCalls.definition.mockRejectedValue(new Error('boom'))
    render(<Page />)
    expect(await screen.findByText('タグを読み込めませんでした')).toBeTruthy()
    const retry = await screen.findByRole('button', { name: 'もう一度読み込む' })
    await act(async () => {
      retry.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(apiCalls.definition).toHaveBeenCalledTimes(2)
  })

  it('正常のときは編集器を出す', async () => {
    okFixtures()
    render(<Page />)
    expect(await screen.findByTestId('tag-editor')).toBeTruthy()
  })
})

describe('M956 保存の再送は同じ要求キー', () => {
  it('失敗後の再送は同じキー・成功後は新しいキー', async () => {
    okFixtures()
    apiCalls.updateDefinition
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        success: true,
        data: { ...definition, queued: 0, replayed: true },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { ...definition, queued: 0, replayed: false },
      })
    render(<Page />)
    expect(await screen.findByTestId('tag-editor')).toBeTruthy()

    await act(async () => {
      await captured.onSave(values, false, false)
    })
    await act(async () => {
      await captured.onSave(values, false, false)
    })
    const firstKey = apiCalls.updateDefinition.mock.calls[0]?.[4] as string
    const secondKey = apiCalls.updateDefinition.mock.calls[1]?.[4] as string
    expect(firstKey).toBeTruthy()
    // 応答消失後の再送は同じ要求キー（保存済みとして返る）。
    expect(secondKey).toBe(firstKey)
    // 再送の結果は「保存済みでした」と出す。
    expect(await screen.findByText('保存済みでした。')).toBeTruthy()

    await act(async () => {
      await captured.onSave(values, false, false)
    })
    const thirdKey = apiCalls.updateDefinition.mock.calls[2]?.[4] as string
    // 成功した保存のキーは捨て、次の保存は新しいキー。
    expect(thirdKey).toBeTruthy()
    expect(thirdKey).not.toBe(firstKey)
  })
})
