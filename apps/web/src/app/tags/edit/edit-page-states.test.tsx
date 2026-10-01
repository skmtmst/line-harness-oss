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

vi.hoisted(() => {
  // 実 api モジュールは読み込み時に API_URL を要求するため、先に決めておく。
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
})
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
vi.mock('@/lib/api', async (importOriginal) => {
  // 保存失敗の文言は本物の describeSaveFailure で付ける（WRITE-01 の契約）。
  // ApiError だけは既存試験の Fake のままにし、原 assert を変えない。
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ApiError: fakes.FakeApiError,
    describeSaveFailure: actual.describeSaveFailure,
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
  }
})
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
  vi.unstubAllGlobals()
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

/*
 * T05/T08: 保存の500は正規 fetchApi 境界を通し、内部文ではなく
 * 日本語の再試行案内を出す。Error("network") の直接 reject だけを
 * HTTP500 の合格証拠にしない。
 */
type PatchedCall = { url: string; init: RequestInit }

function stubPatchThenReplayed() {
  const calls: PatchedCall[] = []
  let first = true
  const stub = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    if (String(url).endsWith('/api/client-errors')) {
      return { ok: true, status: 204, headers: { get: () => null }, json: async () => ({}), text: async () => '{}' }
    }
    if (first) {
      first = false
      // 実 Worker と同じ正規形式の500（routes/tags.ts の catch）。
      const body = { success: false, error: 'Internal server error' }
      return { ok: false, status: 500, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) }
    }
    const body = { success: true, data: { queued: 0, replayed: true } }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) }
  })
  vi.stubGlobal('fetch', stub as unknown as typeof fetch)
  return calls
}

async function useRealSave() {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  apiCalls.updateDefinition.mockImplementation((...args: unknown[]) =>
    (real.api.tags.updateDefinition as unknown as (...call: unknown[]) => Promise<unknown>)(...args),
  )
}

function tagPatchCalls(calls: PatchedCall[]) {
  return calls.filter((call) => call.url.endsWith('/api/tags/t1') && call.init.method === 'PATCH')
}

function idempotencyKeys(calls: PatchedCall[]) {
  return tagPatchCalls(calls).map((call) => (call.init.headers as Record<string, string>)?.['Idempotency-Key'])
}

describe('保存500は日本語の再試行案内を出す（T05/T08）', () => {
  it('通常保存の500は日本語案内・同画面の再送で保存済み', async () => {
    okFixtures()
    const calls = stubPatchThenReplayed()
    await useRealSave()
    render(<Page />)
    expect(await screen.findByTestId('tag-editor')).toBeTruthy()

    await act(async () => {
      await captured.onSave(values, false, false)
    })
    expect(await screen.findByText(/サーバー側で保存できませんでした/)).toBeTruthy()
    expect(screen.queryByText(/API error/)).toBeNull()
    // 編集器は残り、再送できる状態を保つ。
    expect(screen.getByTestId('tag-editor')).toBeTruthy()

    await act(async () => {
      await captured.onSave(values, false, false)
    })
    expect(await screen.findByText('保存済みでした。')).toBeTruthy()
    // 応答消失後の再送は同じ要求キー（M956 を保つ）。
    const keys = idempotencyKeys(calls)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
  })

  it('遡及確認後の保存500も日本語案内・引き換え券を付けて再送成功', async () => {
    okFixtures()
    const calls = stubPatchThenReplayed()
    await useRealSave()
    render(<Page />)
    expect(await screen.findByTestId('tag-editor')).toBeTruthy()

    // 実UIの遡及ONと同じく、編集器の値自体も遡及ありにする。
    const valuesRetroOn = { ...values, applyToExisting: true } as unknown as TagEditorValues
    await act(async () => {
      await captured.onSave(valuesRetroOn, false, true, 'preview-1')
    })
    expect(await screen.findByText(/サーバー側で保存できませんでした/)).toBeTruthy()
    expect(screen.queryByText(/API error/)).toBeNull()

    await act(async () => {
      await captured.onSave(valuesRetroOn, false, true, 'preview-1')
    })
    expect(await screen.findByText('保存済みでした。')).toBeTruthy()
    const patches = tagPatchCalls(calls)
    expect(patches).toHaveLength(2)
    // 実payloadは遡及あり＋引き換え券付き。引き換え券は再送の同一性に入れない。
    expect(JSON.parse(String(patches[0]?.init.body))).toMatchObject({ applyToExisting: true, previewToken: 'preview-1' })
    expect(JSON.parse(String(patches[1]?.init.body))).toMatchObject({ applyToExisting: true, previewToken: 'preview-1' })
    const keys = idempotencyKeys(calls)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
  })
})

describe('保管済みタグの保存500も日本語案内を出す', () => {
  it('入力を保持し、再送で保存する', async () => {
    const archivedTag = { ...tag, status: 'archived', description: '説明前' } as unknown as Tag
    apiCalls.definition.mockResolvedValue({ success: true, data: { tag: archivedTag, automation: null } })
    apiCalls.dependencies.mockResolvedValue({ success: true, data: dependencies })
    apiCalls.listGroups.mockResolvedValue({ success: true, data: [] })
    const calls = stubPatchThenReplayed()
    const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
    apiCalls.updateArchived.mockImplementation((...args: unknown[]) =>
      (real.api.tags.updateArchivedNameAndDescription as unknown as (...call: unknown[]) => Promise<unknown>)(...args),
    )
    const { notifyToast } = await import('@/components/shared/toast')
    render(<Page />)
    const nameInput = await screen.findByDisplayValue('通常タグ')
    const saveButton = await screen.findByRole('button', { name: '保存する' })

    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(await screen.findByText(/サーバー側で保存できませんでした/)).toBeTruthy()
    expect(screen.queryByText(/API error/)).toBeNull()
    // 入力は保持される。
    expect((nameInput as HTMLInputElement).value).toBe('通常タグ')

    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // 再送は保存済みとして返る（M956）。
    expect(notifyToast).toHaveBeenCalledWith('保存済みでした。')
    const keys = idempotencyKeys(calls)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
  })
})
