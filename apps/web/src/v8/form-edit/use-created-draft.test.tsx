// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { forgetCreatedFormDraft, readCreatedFormDraft, rememberCreatedFormDraft } from '@/lib/form-draft-session'
import { useCreatedDraft } from './use-created-draft'
import { ApiError } from '@/lib/api'
vi.hoisted(() => { process.env.NEXT_PUBLIC_API_URL ||= 'http://worker.test' })
const mocks = vi.hoisted(() => ({ impact: vi.fn(), remove: vi.fn(), get: vi.fn() }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, forms: { ...actual.api.forms, deleteImpact: mocks.impact, remove: mocks.remove, get: mocks.get } } }
})
const options = { accountId: 'a', id: 'draft', revision: 1, loaded: true, published: false, canEdit: true, canDelete: true,
  captureResource: () => () => true, waitForSave: (): Promise<unknown> | null => null }
beforeEach(() => {
  forgetCreatedFormDraft('a', 'draft'); forgetCreatedFormDraft('b', 'draft')
  rememberCreatedFormDraft('a', 'draft', 1)
  mocks.impact.mockReset().mockResolvedValue({ success: true, data: { canDelete: true, contentRevision: 1, revision: 9 } })
  mocks.get.mockReset()
  mocks.remove.mockReset().mockResolvedValue({ success: true, data: {} })
})
afterEach(() => { cleanup(); forgetCreatedFormDraft('a', 'draft'); forgetCreatedFormDraft('b', 'draft') })
it('自動保存した版は引き継ぎ、手で保存した下書きは自動作成の扱いから外す', () => {
  const hook = renderHook(props => useCreatedDraft(props), { initialProps: options })
  act(() => { hook.result.current.saved(2, true); hook.rerender({ ...options, revision: 2 }) })
  expect(hook.result.current.owned).toBe(true)
  expect(readCreatedFormDraft('a', 'draft')).toBe(2)
  act(() => hook.result.current.saved(3, false))
  expect(readCreatedFormDraft('a', 'draft')).toBeNull()
  expect(hook.result.current.owned).toBe(false)
})
it.each([{ accountId: 'b' }, { revision: 2 }, { published: true }])('別の店・他の版・公開済みのフォームを自動作成の下書きとして消さない（%j）', async override => {
  const hook = renderHook(() => useCreatedDraft({ ...options, ...override }))
  await act(async () => hook.result.current.discard(vi.fn()))
  expect(hook.result.current.owned).toBe(false)
  expect(mocks.remove).not.toHaveBeenCalled()
  expect(mocks.impact).not.toHaveBeenCalled()
})
it('閲覧のみでは下書きを消す操作を持たず、削除を送らない', async () => {
  const hook = renderHook(() => useCreatedDraft({ ...options, canEdit: false }))
  await act(async () => hook.result.current.discard(vi.fn()))
  expect(hook.result.current.owned).toBe(false)
  expect(mocks.remove).not.toHaveBeenCalled()
})
it('実行中の自動保存を待ち、自分が保存した新しい版を確かめてから消す', async () => {
  let settle!: () => void
  let pending: Promise<void> | null = new Promise(done => { settle = done })
  mocks.impact.mockResolvedValue({ success: true, data: { canDelete: true, contentRevision: 2, revision: 10 } })
  const initial = { ...options, waitForSave: () => pending }
  const hook = renderHook(props => useCreatedDraft(props), { initialProps: initial })
  const leave = vi.fn()
  let discarded!: Promise<void>
  act(() => { discarded = hook.result.current.discard(leave) })
  expect(mocks.impact).not.toHaveBeenCalled()
  await act(async () => { hook.result.current.saved(2, true); hook.rerender({ ...initial, revision: 2 }); pending = null; settle(); await discarded })
  await waitFor(() => expect(leave).toHaveBeenCalledOnce())
  expect(mocks.remove).toHaveBeenCalledWith('draft', 'a', 10)
})
it('確認中に編集権限がなくなった場合は削除を送らない', async () => {
  let settle!: (value: unknown) => void
  mocks.impact.mockImplementationOnce(() => new Promise(done => { settle = done }))
  const hook = renderHook(props => useCreatedDraft(props), { initialProps: options })
  let discarded!: Promise<void>
  act(() => { discarded = hook.result.current.discard(vi.fn()) })
  hook.rerender({ ...options, canEdit: false })
  await act(async () => { settle({ success: true, data: { canDelete: true, contentRevision: 1, revision: 9 } }); await discarded })
  expect(mocks.remove).not.toHaveBeenCalled()
})

it('編集を任されたスタッフでも削除権限がなければ下書きを消さない', async () => {
  const hook = renderHook(() => useCreatedDraft({ ...options, canDelete: false }))
  await act(async () => hook.result.current.discard(vi.fn()))
  expect(hook.result.current.owned).toBe(true)
  expect(mocks.impact).not.toHaveBeenCalled()
  expect(mocks.remove).not.toHaveBeenCalled()
})
it('削除の応答が失われても同じ店の同じフォームが見つからなければ移れる', async () => {
  mocks.remove.mockRejectedValueOnce(new Error('connection dropped'))
  mocks.get.mockRejectedValueOnce(new ApiError(404, 'missing'))
  const hook = renderHook(() => useCreatedDraft(options))
  const leave = vi.fn()
  await act(async () => hook.result.current.discard(leave))
  expect(mocks.get).toHaveBeenCalledWith('draft', 'a')
  expect(leave).toHaveBeenCalledOnce()
  expect(readCreatedFormDraft('a', 'draft')).toBeNull()
})
it('削除の応答も存在確認も失敗した場合は消えたと決めつけず移らない', async () => {
  mocks.remove.mockRejectedValueOnce(new Error('connection dropped'))
  mocks.get.mockRejectedValueOnce(new Error('offline'))
  const hook = renderHook(() => useCreatedDraft(options))
  const leave = vi.fn()
  await act(async () => hook.result.current.discard(leave))
  expect(leave).not.toHaveBeenCalled()
  expect(hook.result.current.error).not.toBe('')
  expect(readCreatedFormDraft('a', 'draft')).toBe(1)
})
