// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { forgetStaffIdentity, readStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
const fixture = vi.hoisted(() => ({ id: 'sc-a', account: 'a', loading: false, newStep: false }))
const calls = vi.hoisted(() => ({ read: vi.fn(), tags: vi.fn(), templates: vi.fn(), add: vi.fn(), update: vi.fn(), push: vi.fn(), invalidate: vi.fn(), draftGet: vi.fn(), draftSave: vi.fn(), draftDelete: vi.fn() }))
const held = vi.hoisted(() => ({ save: undefined as undefined | (() => unknown), cancel: undefined as undefined | (() => unknown), skip: undefined as undefined | (() => unknown), clear: undefined as undefined | (() => unknown) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('id='+fixture.id), useRouter: () => ({ push: calls.push }) }))
vi.mock('next/link', () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ accounts: [{ id: 'a', name: '見本' }], selectedAccountId: fixture.account, loading: fixture.loading }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => readStaffIdentity()?.role ?? null }))
vi.mock('@/components/scenarios/scenario-reference-data', () => ({ scenarioReferenceData: { scenario: calls.read, tags: calls.tags, templates: calls.templates, invalidateScenario: calls.invalidate } }))
vi.mock('@/components/scenarios/insert-toolbar', () => ({ default: () => null }))
vi.mock('@/components/templates', async original => {
  const actual = await original<typeof import('@/components/templates')>()
  const text = (value: React.ReactNode): string => React.Children.toArray(value).map(item => React.isValidElement<{ children?: React.ReactNode }>(item) ? text(item.props.children) : String(item)).join('')
  const capture = (value: React.ReactNode): void => { React.Children.forEach(value, item => {
    if (!React.isValidElement<{ children?: React.ReactNode; onClick?: () => unknown }>(item)) return
    const label = text(item.props.children)
    if (item.props.onClick) {
      if (label.includes('作って編集へ')) held.save = item.props.onClick
      if (label.includes('1通目はあとで書く')) held.skip = item.props.onClick
      if (label === 'キャンセル') held.cancel = item.props.onClick
    }
    capture(item.props.children)
  }) }
  return { ...actual, CreatePage: (props: React.ComponentProps<typeof actual.CreatePage>) => { capture(props.footerActions); return <actual.CreatePage {...props} /> } }
})
vi.mock('@/v8/autosave/public/use-scenario-draft/index', async original => {
  const actual = await original<typeof import('@/v8/autosave/public/use-scenario-draft/index')>()
  return { ...actual, useScenarioDraft: <T,>(options: Parameters<typeof actual.useScenarioDraft<T>>[0]) => { const draft = actual.useScenarioDraft(options); held.clear = draft.clear; return draft } }
})
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, scenarios: { ...actual.api.scenarios, addStep: calls.add, updateStep: calls.update }, scenarioDrafts: { get: calls.draftGet, save: calls.draftSave, delete: calls.draftDelete } } }
})
import FirstStep from './first-step'
import { ApiError } from '@/lib/api'
const step = { id: 'step-a', scenarioId: 'sc-a', stepOrder: 1, messageType: 'text', messageContent: '手元の本文', offsetDays: 0, offsetMinutes: 90, delayMinutes: 0, deliveryTime: null, templateId: null, question: null, targetCondition: null }
const row = (id = fixture.id) => ({ id, name: '見本のシナリオ', lineAccountId: 'a', deliveryMode: 'elapsed', steps: fixture.newStep ? [] : [{ ...step, scenarioId: id, id: id === 'sc-a' ? 'step-a' : 'step-b' }] })
const person = (role: 'owner' | 'admin' | 'staff' | 'viewer', extra: Partial<StaffMember> = {}) => { verifiedStaffRole(role); rememberStaffIdentity({ ...readStaffIdentity()!, ...extra }) }
const proxy = () => rememberSessionSnapshot({ stepUpMethod: 'totp', unfamiliarAt: null, impersonation: { mode: 'read' } as never })
const body = () => screen.getByRole('textbox', { name: '本文', exact: true }) as HTMLInputElement
const ready = async () => { const view = render(<FirstStep />); await screen.findByRole('textbox', { name: '本文', exact: true }); return view }
const invoke = async (fn: (() => unknown) | undefined) => { expect(fn).toBeTypeOf('function'); await act(async () => { await fn!() }) }
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { resolve, promise } }
beforeEach(() => {
  forgetSessionSnapshot(); person('owner'); fixture.id = 'sc-a'; fixture.account = 'a'; fixture.loading = false; fixture.newStep = false
  Object.values(calls).forEach(call => call.mockReset()); held.save = held.cancel = held.skip = held.clear = undefined
  calls.read.mockImplementation(async (id: string) => ({ success: true, data: row(id) })); calls.tags.mockResolvedValue({ success: true, data: [] }); calls.templates.mockResolvedValue({ success: true, data: [] })
  calls.update.mockImplementation(async (_scenarioId: string, stepId: string) => ({ success: true, data: { ...step, id: stepId } })); calls.add.mockResolvedValue({ success: true, data: { ...step, id: 'step-new' } })
  calls.draftGet.mockRejectedValue(new ApiError(404, 'not_found', 'not_found'))
  calls.draftSave.mockImplementation(async (account: string, key: string, value: { content: unknown }) => ({ success: true, data: { key, lineAccountId: account, content: value.content, version: 'version-a', updatedAt: new Date().toISOString() } }))
  calls.draftDelete.mockResolvedValue({ success: true }); document.documentElement.dataset.theme = 'v8'
})
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot(); vi.useRealTimers(); localStorage.clear(); sessionStorage.clear() })

it.each(['owner', 'admin', 'staff'] as const)('%sの編集鍵による1通目の通常更新は1回', async role => {
  person(role, role === 'staff' ? { permissionKeys: ['/scenarios', 'scenario.definition.edit'] } : {})
  await ready(); await invoke(held.save)
  expect(calls.update).toHaveBeenCalledTimes(1)
  expect(calls.update).toHaveBeenCalledWith('sc-a', 'step-a', expect.objectContaining({ messageContent: '手元の本文', offsetMinutes: 90 }))
  expect(calls.push).toHaveBeenCalledWith('/scenarios/detail?id=sc-a')
})

it.each(['viewer', 'staff', 'readOnly', 'view_only', 'proxy', 'unknown'] as const)('保持したstep保存は%sへの切替後に書かず、GETと本文を残す', async kind => {
  await ready(); const old = held.save
  act(() => {
    if (kind === 'viewer' || kind === 'staff') person(kind)
    else if (kind === 'unknown') forgetStaffIdentity()
    else if (kind === 'proxy') proxy()
    else person('owner', kind === 'readOnly' ? { readOnly: true } : { roleBundle: 'view_only' })
  })
  await invoke(old)
  expect(calls.update).not.toHaveBeenCalled(); expect(calls.add).not.toHaveBeenCalled(); expect(calls.draftDelete).not.toHaveBeenCalled(); expect(calls.push).not.toHaveBeenCalled()
  expect(calls.read).toHaveBeenCalledWith('sc-a'); expect(body().value || body().textContent).toBe('手元の本文')
})

it.each(['person', 'session', 'id', 'account'] as const)('許可が戻っても%sが切り替わった古いstep操作を再開しない', async kind => {
  const view = await ready(); const old = held.save
  act(() => {
    if (kind === 'person') { const owner = readStaffIdentity()!; forgetStaffIdentity(); rememberStaffIdentity(owner) }
    if (kind === 'session') { proxy(); forgetSessionSnapshot() }
  })
  if (kind === 'id' || kind === 'account') {
    if (kind === 'id') fixture.id = 'sc-b'; else fixture.account = 'b'; view.rerender(<FirstStep />)
    if (kind === 'id') fixture.id = 'sc-a'; else fixture.account = 'a'; view.rerender(<FirstStep />)
  }
  await invoke(old); expect(calls.update).not.toHaveBeenCalled(); expect(calls.push).not.toHaveBeenCalled()
})

it('同時に保持された保存が来てもstep更新は1回', async () => {
  const pending = deferred<unknown>(); calls.update.mockReturnValue(pending.promise); await ready(); const old = held.save
  let saving!: unknown; act(() => { saving = old!() }); await invoke(old)
  expect(calls.update).toHaveBeenCalledTimes(1)
  await act(async () => { pending.resolve({ success: true, data: step }); await saving })
  expect(calls.push).toHaveBeenCalledTimes(1)
})

it('応答前にread代理へ切り替わると下書き削除と遷移を止め、保存済みを知らせる', async () => {
  const pending = deferred<unknown>(); calls.update.mockReturnValue(pending.promise); await ready()
  let saving!: unknown; act(() => { saving = held.save!() }); act(() => proxy())
  await act(async () => { pending.resolve({ success: true, data: step }); await saving })
  expect(calls.update).toHaveBeenCalledTimes(1); expect(calls.draftDelete).not.toHaveBeenCalled(); expect(calls.push).not.toHaveBeenCalled()
  expect(screen.getByRole('link', { name: '保存したシナリオを見る' }).getAttribute('href')).toBe('/scenarios/detail?id=sc-a')
})

it('新規step応答の途中で拒否へ替わってもIDを保持し、復帰後は同じstepを更新する', async () => {
  fixture.newStep = true; const pending = deferred<unknown>(); calls.add.mockReturnValue(pending.promise); await ready()
  fireEvent.change(body(), { target: { value: '新しい本文' } })
  let saving!: unknown; act(() => { saving = held.save!() }); act(() => proxy())
  await act(async () => { pending.resolve({ success: true, data: { ...step, id: 'step-new' } }); await saving })
  expect(calls.add).toHaveBeenCalledTimes(1); expect(calls.push).not.toHaveBeenCalled()
  act(() => forgetSessionSnapshot()); await invoke(held.save)
  expect(calls.add).toHaveBeenCalledTimes(1); expect(calls.update).toHaveBeenCalledWith('sc-a', 'step-new', expect.objectContaining({ messageContent: '新しい本文' }))
})

it('account読込中とunmount後は、保持した保存でも書かない', async () => {
  const view = await ready(); const old = held.save
  fixture.loading = true; view.rerender(<FirstStep />); await invoke(old); await invoke(held.save)
  expect(calls.update).not.toHaveBeenCalled(); view.unmount(); await invoke(old); expect(calls.update).not.toHaveBeenCalled()
})

it('古いidの応答は新しい画面の成功/遷移へ持ち込まない', async () => {
  const pending = deferred<unknown>(); calls.update.mockReturnValue(pending.promise); const view = await ready()
  let saving!: unknown; act(() => { saving = held.save!() }); fixture.id = 'sc-b'; view.rerender(<FirstStep />)
  await waitFor(() => expect(calls.read).toHaveBeenCalledWith('sc-b')); await screen.findByRole('textbox', { name: '本文', exact: true })
  await act(async () => { pending.resolve({ success: true, data: step }); await saving })
  expect(calls.push).not.toHaveBeenCalled(); expect(screen.queryByRole('link', { name: '保存したシナリオを見る' })).toBeNull()
  calls.update.mockResolvedValue({ success: true, data: { ...step, scenarioId: 'sc-b', id: 'step-b' } })
  await invoke(held.save)
  expect(calls.update).toHaveBeenLastCalledWith('sc-b', 'step-b', expect.objectContaining({ messageContent: '手元の本文' }))
})

it('下書きは通常保存できるが、read代理への切替後のタイマーと保持clearは書かない', async () => {
  await ready(); vi.useFakeTimers()
  fireEvent.change(body(), { target: { value: '通常の書きかけ' } }); await act(async () => { await vi.advanceTimersByTimeAsync(2200) })
  expect(calls.draftSave).toHaveBeenCalledTimes(1); expect(calls.draftGet).toHaveBeenCalled()
  const clear = held.clear
  fireEvent.change(body(), { target: { value: '保持した書きかけ' } }); act(() => proxy())
  await act(async () => { await vi.advanceTimersByTimeAsync(2200) }); await invoke(clear); await invoke(held.cancel)
  expect(calls.draftSave).toHaveBeenCalledTimes(1); expect(calls.draftDelete).not.toHaveBeenCalled(); expect(calls.push).toHaveBeenCalledWith('/scenarios')
  expect(body().value || body().textContent).toBe('保持した書きかけ')
})

it('閲覧への切替後も、あとで書く読み取り遷移は止めない', async () => {
  await ready(); act(() => proxy()); await invoke(held.skip)
  expect(calls.push).toHaveBeenCalledWith('/scenarios/detail?id=sc-a'); expect(calls.update).not.toHaveBeenCalled(); expect(calls.add).not.toHaveBeenCalled()
})


it('新規保存の成功後に同じ保持callbackが来ても、作成済みのstepを更新し二重追加しない', async () => {
  fixture.newStep = true
  await ready(); fireEvent.change(body(), { target: { value: '追加は一度だけ' } })
  const old = held.save
  await invoke(old); await invoke(old)
  expect(calls.add).toHaveBeenCalledTimes(1)
  expect(calls.update).toHaveBeenCalledTimes(1)
  expect(calls.update).toHaveBeenCalledWith('sc-a', 'step-new', expect.objectContaining({ messageContent: '追加は一度だけ' }))
})


it('古い保存の失敗がread代理への切替後に返っても、新しい画面へエラーを持ち込まない', async () => {
  const pending = deferred<unknown>(); calls.update.mockReturnValue(pending.promise); await ready()
  let saving!: unknown; act(() => { saving = held.save!() }); act(() => proxy())
  await act(async () => { pending.resolve(Promise.reject(new ApiError(403, 'denied', 'denied'))); await saving })
  expect(screen.queryByText(/保存できませんでした/)).toBeNull()
  expect(calls.draftDelete).not.toHaveBeenCalled(); expect(calls.push).not.toHaveBeenCalled()
  expect(body().value || body().textContent).toBe('手元の本文')
})


it('描画を閉じた後の保持保存は、本人が同じでもAPIを呼ばない', async () => {
  const view = await ready(); const old = held.save
  view.unmount(); await invoke(old)
  expect(calls.update).not.toHaveBeenCalled(); expect(calls.add).not.toHaveBeenCalled(); expect(calls.push).not.toHaveBeenCalled()
})


it('本人が別のownerへ替わっても古い下書き削除は使わず、新しい操作だけを許す', async () => {
  await ready(); vi.useFakeTimers()
  fireEvent.change(body(), { target: { value: '保存しておく書きかけ' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(2200) })
  expect(calls.draftSave).toHaveBeenCalledTimes(1)
  const oldClear = held.clear
  act(() => person('owner', { id: 'different-owner' }))
  await invoke(oldClear)
  expect(calls.draftDelete).not.toHaveBeenCalled()
  await invoke(held.clear)
  expect(calls.draftDelete).toHaveBeenCalledTimes(1)
  expect(calls.draftDelete).toHaveBeenCalledWith('a', 'scenario:sc-a:first-step', 'version-a')
  expect(calls.update).not.toHaveBeenCalled(); expect(calls.add).not.toHaveBeenCalled()
})
