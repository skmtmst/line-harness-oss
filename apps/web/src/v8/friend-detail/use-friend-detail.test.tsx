// @vitest-environment happy-dom
import { useLayoutEffect } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ fields: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  const empty = async () => ({ success: true, data: {} })
  return { ...actual, api: { ...actual.api,
    friends: { ...actual.api.friends, get: async (id: string) => ({ success: true, data: { id } }), upcoming: empty, mileage: empty, richMenu: empty },
    friendFields: { ...actual.api.friendFields, forFriend: net.fields, saveForFriend: net.save },
    folders: { list: async () => ({ success: true, data: [] }) },
  } }
})
import { useFriendDetail } from './use-friend-detail'
const reply = (value: string) => ({ success: true, data: { items: [{ id: 'name', value }], hiddenPersonalCount: 0 } })
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() }) }
beforeEach(() => { vi.clearAllMocks(); net.fields.mockImplementation(async (id: string) => reply(id)); net.save.mockResolvedValue({ success: true, data: { updated: 1 } }) })
afterEach(cleanup)
function mount() { return renderHook(({ id, account }) => useFriendDetail(id, account, 'info'), { initialProps: { id: 'A', account: 'account-1' } }) }
it.each(['success', 'failure', 'throw'] as const)('WEB-124: Aの保存の%sがBの情報・通知・保存待ちへ混ざらない', async (outcome) => {
  const pending = deferred<unknown>(); net.save.mockReturnValue(pending.promise)
  const view = mount(); await flush()
  act(() => view.result.current.setValues({ name: 'A edited' }))
  let saving!: Promise<void>; act(() => { saving = view.result.current.saveFields() })
  view.rerender({ id: 'B', account: 'account-1' }); await flush()
  expect(view.result.current.saving).toBe(false)
  act(() => view.result.current.setValues({ name: 'B edited' }))
  const pendingB = deferred<unknown>(); net.save.mockReturnValue(pendingB.promise)
  act(() => { void view.result.current.saveFields() })
  await act(async () => { if (outcome === 'throw') pending.reject(new Error('old failure')); else pending.resolve(outcome === 'success' ? { success: true, data: { updated: 1 }, warnings: ['A warning'] } : { success: false, error: 'A failure' }); await saving })
  await flush()
  expect(view.result.current.friend?.id).toBe('B')
  expect(view.result.current.values.name).toBe('B edited')
  expect(view.result.current.fields[0]?.value).toBe('B')
  expect(view.result.current.saveError).toBe('')
  expect(view.result.current.saveNotice).toBe('')
  expect(view.result.current.warnings).toEqual([])
  expect(view.result.current.saving).toBe(true)
  expect(net.fields.mock.calls.map(([id]) => id)).toEqual(['A', 'B'])
  await act(async () => pendingB.resolve({ success: true, data: { updated: 1 } }))
})
it('WEB-124: 保存後に同じ人を再取得し、保存・再取得待ち中の追記を残す', async () => {
  const pending = deferred<unknown>(); net.save.mockReturnValue(pending.promise)
  const view = mount(); await flush()
  act(() => view.result.current.setValues({ name: 'sent' }))
  act(() => { void view.result.current.saveFields() })
  act(() => view.result.current.setValues({ name: 'typed while saving' }))
  const reload = deferred<unknown>(); net.fields.mockReturnValue(reload.promise)
  await act(async () => pending.resolve({ success: true, data: { updated: 1 } }))
  act(() => view.result.current.setValues({ name: 'typed while reloading' }))
  await act(async () => reload.resolve(reply('server saved')))
  expect(view.result.current.fields[0]?.value).toBe('server saved')
  expect(view.result.current.values.name).toBe('typed while reloading')
  expect(view.result.current.saveNotice).toBe('1 件を保存しました')
})
it('WEB-124: 戻ってきたAも別世代として古いAの保存を捨てる', async () => {
  const pending = deferred<unknown>(); net.save.mockReturnValue(pending.promise)
  const view = mount(); await flush()
  act(() => view.result.current.setValues({ name: 'old A' }))
  act(() => { void view.result.current.saveFields() })
  view.rerender({ id: 'B', account: 'account-1' }); await flush()
  view.rerender({ id: 'A', account: 'account-1' }); await flush()
  await act(async () => pending.resolve({ success: true, data: { updated: 1 } }))
  expect(net.fields).toHaveBeenCalledTimes(3)
  expect(view.result.current.saveNotice).toBe('')
})
it('WEB-124: 同じ友だちIDでもアカウントが変われば保存結果を捨てる', async () => {
  const pending = deferred<unknown>(); net.save.mockReturnValue(pending.promise)
  const view = mount(); await flush()
  act(() => view.result.current.setValues({ name: 'old account' }))
  act(() => { void view.result.current.saveFields() })
  view.rerender({ id: 'A', account: 'account-2' }); await flush()
  await act(async () => pending.resolve({ success: true, data: { updated: 1 } }))
  expect(net.fields).toHaveBeenCalledTimes(2)
  expect(view.result.current.saveNotice).toBe('')
})
it('WEB-124: 切替前の読込・保存の関数を呼んでも古い対象へ要求しない', async () => {
  const view = mount(); await flush()
  act(() => view.result.current.setValues({ name: 'old A' }))
  const old = view.result.current
  view.rerender({ id: 'B', account: 'account-1' }); await flush()
  await act(async () => { await old.loadFields(); await old.saveFields() })
  expect(net.fields.mock.calls.map(([id]) => id)).toEqual(['A', 'B'])
  expect(net.save).not.toHaveBeenCalled()
  expect(view.result.current.values.name).toBe('B')
})
it('WEB-124: 保存を連打しても同じ人へ二重要求を出さない', async () => {
  const pending = deferred<unknown>(); net.save.mockReturnValue(pending.promise)
  const view = mount(); await flush()
  act(() => view.result.current.setValues({ name: 'sent' }))
  act(() => { void view.result.current.saveFields(); void view.result.current.saveFields() })
  expect(net.save).toHaveBeenCalledTimes(1)
  await act(async () => pending.resolve({ success: true, data: { updated: 1 } }))
})
it('WEB-124: Aの保存後に遅れて来る再取得でBの情報欄を上書きしない', async () => {
  const pending = deferred<unknown>(); net.save.mockReturnValue(pending.promise)
  const view = mount(); await flush()
  act(() => view.result.current.setValues({ name: 'A edited' }))
  act(() => { void view.result.current.saveFields() })
  view.rerender({ id: 'B', account: 'account-1' }); await flush()
  await act(async () => pending.resolve({ success: true, data: { updated: 1 } }))
  await flush()
  expect(view.result.current.friend?.id).toBe('B')
  expect(view.result.current.fields[0]?.value).toBe('B')
  expect(view.result.current.values.name).toBe('B')
  expect(view.result.current.saveNotice).toBe('')
  expect(net.fields.mock.calls.map(([id]) => id)).toEqual(['A', 'B'])
})

it('WEB-124: 切り替え直後の描画にも前の人の情報を出さず保存できない', async () => {
  const seen: Array<{ id: string; value?: string; friend?: string }> = []
  const view = renderHook(({ id }) => {
    const state = useFriendDetail(id, 'account-1', 'info')
    useLayoutEffect(() => {
      seen.push({ id, value: state.values.name, friend: state.friend?.id })
      if (id === 'B' && state.values.name === 'A edited') void state.saveFields()
    }, [id, state])
    return state
  }, { initialProps: { id: 'A' } })
  await flush()
  act(() => view.result.current.setValues({ name: 'A edited' }))
  view.rerender({ id: 'B' }); await flush()
  expect(seen.filter((item) => item.id === 'B').some((item) => item.value === 'A edited' || item.friend === 'A')).toBe(false)
  expect(net.save).not.toHaveBeenCalled()
 })
