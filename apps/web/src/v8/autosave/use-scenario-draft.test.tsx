// @vitest-environment happy-dom
/*
 * シナリオの下書きをサーバーの下書きの口へ残す（★V8）の試験。
 * 止まって2秒で PUT（新規は版0・以降は返った版）・開き直すと「前の入力を戻す」・捨てると DELETE・
 * 以前のブラウザの書きかけを一度だけ移して消す・409 は最新を読んで競合の帯（上書きしない）・
 * 保存済みの形に戻ったら消す・閲覧のみは読み書きしない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const get = vi.fn()
const save = vi.fn()
const del = vi.fn()
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: { ...actual.api, scenarioDrafts: { get: (...a: unknown[]) => get(...a), save: (...a: unknown[]) => save(...a), delete: (...a: unknown[]) => del(...a) } },
  }
})

import { ApiError } from '@/lib/api'
import { browserDraftKey } from './use-browser-draft'
import { AUTOSAVE_WORDS } from './use-draft-autosave'
import { forgetNewScenarioDraftKey, newScenarioDraftKey, scenarioDraftKey, useScenarioDraft } from './use-scenario-draft'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const KEY = scenarioDraftKey('sc-1', 'info')
const LEGACY = browserDraftKey(['scenario-create', 'account-a', 'sc-1'])
const V1 = '11111111-1111-4111-8111-111111111111'
const V2 = '22222222-2222-4222-8222-222222222222'
const V3 = '33333333-3333-4333-8333-333333333333'
type Props = { value: string; baseline: string; active?: boolean; draftKey?: string | null }
let hook: ReturnType<typeof useScenarioDraft<string>> | null = null
function Harness({ value, baseline, active = true, draftKey = KEY }: Props) {
  hook = useScenarioDraft({ accountId: 'account-a', draftKey, scenarioId: 'sc-1', legacyKey: LEGACY, value, baseline, active })
  return null
}

const draft = (value: string, version: string, updatedAt = new Date(Date.now() - 5000).toISOString()) => ({
  key: KEY, lineAccountId: 'account-a', content: { value }, scenarioId: 'sc-1', stepId: null,
  version, updatedBy: 'staff-1', updatedAt, expiresAt: '2026-12-01T00:00:00.000Z',
})
const notFound = () => Promise.reject(new ApiError(404, 'not_found', 'not_found'))
const conflict = () => Promise.reject(new ApiError(409, 'version_conflict', 'version_conflict'))

let host: HTMLDivElement
let root: Root
const render = async (props: Props) => {
  await act(async () => { root.render(<Harness {...props} />) })
}
const advance = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}
const remount = async (props: Props) => {
  act(() => root.unmount())
  root = createRoot(host)
  await render(props)
}
function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)) },
    removeItem: (key: string) => { map.delete(key) },
    clear: () => map.clear(),
    get length() { return map.size },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', memoryStorage())
  get.mockReset().mockImplementation(notFound)
  save.mockReset()
  del.mockReset().mockResolvedValue({ success: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  hook = null
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useScenarioDraft', () => {
  it('止まって2秒で版0で作り、次は返った版で更新する。帯は「下書き保存済み・n秒前」', async () => {
    save.mockResolvedValueOnce({ success: true, data: draft('春', V1) }).mockResolvedValueOnce({ success: true, data: draft('春の', V2) })
    await render({ value: '', baseline: '' })
    await advance(0)
    await render({ value: '春', baseline: '' })
    expect(hook?.label).toBe(AUTOSAVE_WORDS.unsaved)
    await advance(1900)
    expect(save).not.toHaveBeenCalled()
    await advance(200)
    expect(save).toHaveBeenCalledWith('account-a', KEY, { expectedVersion: 0, content: { value: '春' }, scenarioId: 'sc-1', stepId: null })
    expect(hook?.label).toBe(AUTOSAVE_WORDS.saved('0秒前'))
    await render({ value: '春の', baseline: '' })
    await advance(2100)
    expect(save).toHaveBeenLastCalledWith('account-a', KEY, expect.objectContaining({ expectedVersion: V1, content: { value: '春の' } }))
  })

  it('開き直すと前の入力を出し、決めるまで上書きしない。戻すと値を返す', async () => {
    get.mockResolvedValue({ success: true, data: draft('前の入力', V1) })
    await render({ value: '', baseline: '' })
    await advance(0)
    expect(hook?.pendingAgo).toBe('5秒前')
    await render({ value: '打ちかけ', baseline: '' })
    await advance(3000)
    expect(save).not.toHaveBeenCalled()
    let restored: string | null = null
    act(() => { restored = hook?.restore() ?? null })
    expect(restored).toBe('前の入力')
    expect(hook?.pendingAgo).toBeNull()
  })

  it('「捨てる」で返った版を添えて消す', async () => {
    get.mockResolvedValue({ success: true, data: draft('前の入力', V1) })
    await render({ value: '', baseline: '' })
    await advance(0)
    act(() => hook?.clear())
    expect(del).toHaveBeenCalledWith('account-a', KEY, V1)
    expect(hook?.pendingAgo).toBeNull()
  })

  it('以前のブラウザの書きかけは一度だけサーバーへ移して消す', async () => {
    localStorage.setItem(LEGACY, JSON.stringify({ savedAt: Date.now() - 60_000, value: 'ブラウザの入力' }))
    save.mockResolvedValue({ success: true, data: draft('ブラウザの入力', V1) })
    await render({ value: '', baseline: '' })
    await advance(0)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('account-a', KEY, expect.objectContaining({ expectedVersion: 0, content: { value: 'ブラウザの入力' } }))
    expect(localStorage.getItem(LEGACY)).toBeNull()
    expect(hook?.pendingAgo).toBe('1分前')
    get.mockResolvedValue({ success: true, data: draft('ブラウザの入力', V1) })
    await remount({ value: '', baseline: '' })
    await advance(0)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('移せなければブラウザに残す（次に開いたときにもう一度）', async () => {
    localStorage.setItem(LEGACY, JSON.stringify({ savedAt: Date.now(), value: 'ブラウザの入力' }))
    save.mockRejectedValue(new ApiError(500, 'x', 'x'))
    await render({ value: '', baseline: '' })
    await advance(0)
    expect(localStorage.getItem(LEGACY)).not.toBeNull()
    expect(hook?.pendingAgo).not.toBeNull()
  })

  it('409 は最新を1回読んで競合の帯。上書きせず、読み込むか上書きを選ぶ', async () => {
    save.mockImplementationOnce(conflict)
    await render({ value: '', baseline: '' })
    await advance(0)
    get.mockResolvedValue({ success: true, data: draft('ほかの入力', V2) })
    await render({ value: '自分の入力', baseline: '' })
    await advance(2100)
    expect(save).toHaveBeenCalledTimes(1)
    expect(hook?.conflictAgo).toBe('5秒前')
    await advance(5000)
    expect(save).toHaveBeenCalledTimes(1)

    save.mockResolvedValueOnce({ success: true, data: draft('自分の入力', V3) })
    act(() => hook?.overwrite())
    await advance(2100)
    expect(save).toHaveBeenLastCalledWith('account-a', KEY, expect.objectContaining({ expectedVersion: V2, content: { value: '自分の入力' } }))
    expect(hook?.conflictAgo).toBeNull()
  })

  it('競合の帯で最新を読み込むと最新の値を返し、その版で続ける', async () => {
    save.mockImplementationOnce(conflict)
    await render({ value: '', baseline: '' })
    await advance(0)
    get.mockResolvedValue({ success: true, data: draft('ほかの入力', V2) })
    await render({ value: '自分の入力', baseline: '' })
    await advance(2100)
    let latest: string | null = null
    act(() => { latest = hook?.loadLatest() ?? null })
    expect(latest).toBe('ほかの入力')
    save.mockResolvedValueOnce({ success: true, data: draft('ほかの入力2', V3) })
    await render({ value: 'ほかの入力2', baseline: '' })
    await advance(2100)
    expect(save).toHaveBeenLastCalledWith('account-a', KEY, expect.objectContaining({ expectedVersion: V2 }))
  })

  it('保存済みの形に戻ったら下書きを消す', async () => {
    save.mockResolvedValue({ success: true, data: draft('春', V1) })
    await render({ value: '', baseline: '' })
    await advance(0)
    await render({ value: '春', baseline: '' })
    await advance(2100)
    await render({ value: '', baseline: '' })
    await advance(2100)
    expect(del).toHaveBeenCalledWith('account-a', KEY, V1)
    expect(hook?.label).toBeNull()
  })

  it('閲覧のみは読みも書きもしない', async () => {
    localStorage.setItem(LEGACY, JSON.stringify({ savedAt: Date.now(), value: 'ブラウザの入力' }))
    await render({ value: '', baseline: '', active: false })
    await advance(0)
    await render({ value: '打った', baseline: '', active: false })
    await advance(3000)
    expect(get).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(hook?.label).toBeNull()
    expect(hook?.pendingAgo).toBeNull()
  })

  it('新規のキーはこのブラウザに覚えて同じものを返し、忘れると新しくなる', () => {
    const first = newScenarioDraftKey('account-a')
    expect(first).toMatch(/^new:/)
    expect(newScenarioDraftKey('account-a')).toBe(first)
    forgetNewScenarioDraftKey('account-a')
    expect(newScenarioDraftKey('account-a')).not.toBe(first)
  })
})
