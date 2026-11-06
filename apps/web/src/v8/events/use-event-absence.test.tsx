// @vitest-environment happy-dom
import React, { useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { useEventAbsence } from './use-event-absence'

const mock = vi.hoisted(() => ({ role: 'staff' as string | null, get: vi.fn(), save: vi.fn(), saved: vi.fn(), guard: vi.fn() }))
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), eventsApi: { getEvent: mock.get } }))
vi.mock('@/lib/api/helpers/gap2', () => ({ bookingMakeupApi: { absenceByStore: mock.save } }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => mock.role }))
vi.mock('@/lib/line-accounts-cache', () => ({ loadLineAccounts: vi.fn(async () => ({ success: true, data: [{ id: 'a', name: '対象のアカウント' }] })) }))
vi.mock('@/components/shared/use-permission-lock-reason', () => ({ usePermissionLockReason: (allowed: boolean) => allowed ? undefined : '閲覧のみのため変更できません。' }))
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: (state: unknown) => { mock.guard(state); return { leaveTarget: null, confirmLeave: vi.fn(), cancelLeave: vi.fn(), disarm: vi.fn() } } }))
const now = Date.parse('2030-06-01T00:00:00Z')
const rule = { enabled: true, cutoffHours: 3, validDays: 30, monthlyCap: 2, target: 'same_kind', targetIds: [] }
const target = { bookingId: 'booking-a', eventId: 'class-a', name: '参加者', startsAt: new Date(now + 5 * 3600000).toISOString() }
function Harness({ accountId = 'a', scope = 'slot-a', startsAt = target.startsAt }: { accountId?: string; scope?: string; startsAt?: string }) {
  const [live, setLive] = useState(true)
  const flow = useEventAbsence({ accountId, scope, onSaved: () => { setLive(false); mock.saved() } })
  return <>{live ? <button disabled={!flow.allowed} onClick={() => flow.open({ ...target, startsAt })}>欠席</button> : <p>予約はありません</p>}{flow.notice}{flow.dialog}</>
}
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  mock.role = 'staff'; mock.get.mockReset(); mock.save.mockReset(); mock.saved.mockReset(); mock.guard.mockReset(); forgetSessionSnapshot()
  mock.get.mockResolvedValue({ id: 'class-a', line_account_id: 'a', makeup_rule_json: JSON.stringify(rule) })
  mock.save.mockResolvedValue({ data: { eventBooking: { id: 'booking-a', status: 'absent' }, makeupCredit: { id: 'credit-a' }, reasonIfNone: null } })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); forgetSessionSnapshot(); vi.restoreAllMocks() })
async function open() {
  fireEvent.click(screen.getByRole('button', { name: '欠席' }))
  const dialog = within(await screen.findByRole('dialog', { name: '欠席を受け付ける' }))
  await dialog.findByRole('switch', { name: '振替を1回渡す' })
  return dialog
}

it('スタッフは締め内の振替が選ばれた窓から欠席を送り、最後の予約がなくなっても結果が残る', async () => {
  render(<Harness />); const dialog = await open()
  expect(dialog.getByText('LINEアカウント')).toBeTruthy()
  expect(dialog.getByText('環境')).toBeTruthy()
  expect(await dialog.findByText('対象のアカウント')).toBeTruthy()
  expect(dialog.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  fireEvent.click(dialog.getByRole('button', { name: '欠席にする' }))
  await screen.findByText('予約はありません')
  expect(mock.save).toHaveBeenCalledWith('a', 'booking-a', { grantMakeup: true })
  expect(screen.getByRole('status').textContent).toContain('振替を1回渡しました')
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('締め後は振替を外し、選ぶと理由が必須になり空白のまま送れない', async () => {
  render(<Harness startsAt={new Date(now + 3600000).toISOString()} />); const dialog = await open()
  expect(dialog.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  fireEvent.click(dialog.getByRole('switch'))
  fireEvent.change(dialog.getByLabelText('振替を渡す理由'), { target: { value: '   ' } })
  fireEvent.click(dialog.getByRole('button', { name: '欠席にする' }))
  expect((dialog.getByRole('button', { name: '欠席にする' }) as HTMLButtonElement).disabled).toBe(true)
  expect(dialog.getByRole('status').textContent).toBe('振替を渡す理由を入れると欠席にできます')
  expect(mock.save).not.toHaveBeenCalled()
  fireEvent.change(dialog.getByLabelText('振替を渡す理由'), { target: { value: '  店の都合  ' } })
  expect((dialog.getByRole('button', { name: '欠席にする' }) as HTMLButtonElement).disabled).toBe(false)
  expect(dialog.queryByText('振替を渡す理由を入れると欠席にできます')).toBeNull()
  fireEvent.click(dialog.getByRole('button', { name: '欠席にする' }))
  await waitFor(() => expect(mock.save).toHaveBeenCalledWith('a', 'booking-a', { grantMakeup: true, reason: '店の都合' }))
})

it('締め後でも振替を渡さない選択に戻すと、理由が空のまま欠席を受け付けられる', async () => {
  render(<Harness startsAt={new Date(now + 3600000).toISOString()} />); const dialog = await open()
  fireEvent.click(dialog.getByRole('switch'))
  expect((dialog.getByRole('button', { name: '欠席にする' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(dialog.getByRole('switch'))
  expect((dialog.getByRole('button', { name: '欠席にする' }) as HTMLButtonElement).disabled).toBe(false)
  expect(dialog.queryByText('振替を渡す理由を入れると欠席にできます')).toBeNull()
  fireEvent.click(dialog.getByRole('button', { name: '欠席にする' }))
  await waitFor(() => expect(mock.save).toHaveBeenCalledWith('a', 'booking-a', { grantMakeup: false }))
})

it('窓を開いた後に締めを越えた場合も、送る瞬間に理由を確かめる', async () => {
  render(<Harness />); const dialog = await open()
  vi.mocked(Date.now).mockReturnValue(now + 3 * 3600000)
  fireEvent.click(dialog.getByRole('button', { name: '欠席にする' }))
  expect(await dialog.findByText('締め切り後に振替を渡す理由を入れてください。')).toBeTruthy()
  expect(mock.save).not.toHaveBeenCalled()
})

it('始まった回は欠席の口へ送らず、名簿の読み直しを案内する', async () => {
  render(<Harness />); const dialog = await open()
  fireEvent.click(dialog.getByRole('switch'))
  vi.mocked(Date.now).mockReturnValue(now + 6 * 3600000)
  fireEvent.click(dialog.getByRole('button', { name: '欠席にする' }))
  expect(await dialog.findByText(/この回はすでに始まっています/)).toBeTruthy()
  expect(mock.save).not.toHaveBeenCalled()
})

it('受付の失敗は窓と理由を保ち、再送中の二重押しは一度だけ送る', async () => {
  mock.save.mockRejectedValueOnce(new Error('offline'))
  render(<Harness />); const dialog = await open()
  fireEvent.change(dialog.getByLabelText('振替を渡す理由'), { target: { value: '店から受付' } })
  fireEvent.click(dialog.getByRole('button', { name: '欠席にする' }))
  await dialog.findByRole('alert')
  expect((dialog.getByLabelText('振替を渡す理由') as HTMLTextAreaElement).value).toBe('店から受付')
  let resolve!: (value: unknown) => void
  mock.save.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const confirm = dialog.getByRole('button', { name: '欠席にする' })
  act(() => { fireEvent.click(confirm); fireEvent.click(confirm) })
  expect(mock.save).toHaveBeenCalledTimes(2)
  expect(mock.saved).not.toHaveBeenCalled()
  await act(async () => resolve({ data: { makeupCredit: { id: 'credit-a' }, reasonIfNone: null } }))
  expect(mock.saved).toHaveBeenCalledOnce()
})

it('保存先が返した理由を欄に一度だけ出し、未保存の入力を離脱の番兵へ渡す', async () => {
  mock.save.mockRejectedValueOnce(new ApiError(400, '理由を確認', 'reason_required', undefined, undefined, undefined, { reason: '理由を見直してください。' }))
  render(<Harness />); const dialog = await open()
  fireEvent.change(dialog.getByLabelText('振替を渡す理由'), { target: { value: '受付の理由' } })
  expect(mock.guard).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: true, busy: false }))
  fireEvent.click(dialog.getByRole('button', { name: '欠席にする' }))
  expect(await dialog.findByText('理由を見直してください。')).toBeTruthy()
  expect(dialog.getAllByText('理由を見直してください。')).toHaveLength(1)
  expect(mock.saved).not.toHaveBeenCalled()
})

it.each(['viewer', null])('権限が%sのときは欠席を受け付けない', role => {
  mock.role = role; render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: '欠席' }))
  expect(screen.queryByRole('dialog')).toBeNull(); expect(mock.save).not.toHaveBeenCalled()
})

it.each(['read', 'write'])('窓の途中で%s代理になると送らない', async mode => {
  render(<Harness />); const dialog = await open()
  act(() => rememberSessionSnapshot({ impersonation: { id: 'proxy', mode } as never, unfamiliarAt: null, stepUpMethod: 'none' }))
  fireEvent.click(dialog.getByRole('button', { name: '欠席にする' }))
  expect(mock.save).not.toHaveBeenCalled()
})

it.each([null, '{bad'])('読めない設定（%s）で振替なしと決めつけず、読み直せる', async value => {
  mock.get.mockResolvedValueOnce({ line_account_id: 'a', makeup_rule_json: value })
  render(<Harness />); fireEvent.click(screen.getByRole('button', { name: '欠席' }))
  const dialog = within(await screen.findByRole('dialog', { name: '欠席を受け付ける' }))
  fireEvent.click(await dialog.findByRole('button', { name: '欠席にする' }))
  expect(mock.save).not.toHaveBeenCalled()
  fireEvent.click(await dialog.findByRole('button', { name: 'もう一度読み込む' }))
  await dialog.findByRole('switch')
  expect(mock.get).toHaveBeenCalledTimes(2)
})

it('月上限の結果は案内として残り、振替を渡さない選択を月上限だと誤表示しない', async () => {
  mock.save.mockResolvedValue({ data: { makeupCredit: null, reasonIfNone: 'monthly_cap' } })
  const view = render(<Harness />); const dialog = await open()
  fireEvent.click(dialog.getByRole('button', { name: '欠席にする' }))
  expect((await screen.findByRole('status')).textContent).toContain('今月の振替の上限')
  view.unmount(); render(<Harness />); const second = await open()
  fireEvent.click(second.getByRole('switch'))
  fireEvent.click(second.getByRole('button', { name: '欠席にする' }))
  expect((await screen.findByRole('status')).textContent).toContain('振替は渡していません')
  expect(screen.queryByText(/今月の振替の上限/)).toBeNull()
})

it('既存の振替が返った再送で、上限の理由が付いていても振替ありと知らせる', async () => {
  mock.save.mockResolvedValue({ data: { makeupCredit: { id: 'credit-a' }, reasonIfNone: 'monthly_cap' } })
  render(<Harness />); const dialog = await open(); fireEvent.click(dialog.getByRole('button', { name: '欠席にする' }))
  expect((await screen.findByRole('status')).textContent).toContain('振替を1回渡しました')
})

it('締め後に理由を付けて振替を渡す指定でも、上限で付かなかった時は上限を知らせる', async () => {
  mock.save.mockResolvedValue({ data: { makeupCredit: null, reasonIfNone: 'cutoff_passed' } })
  render(<Harness startsAt={new Date(now + 3600000).toISOString()} />); const dialog = await open()
  fireEvent.click(dialog.getByRole('switch'))
  fireEvent.change(dialog.getByLabelText('振替を渡す理由'), { target: { value: '店の判断で振替を渡す' } })
  fireEvent.click(dialog.getByRole('button', { name: '欠席にする' }))
  expect((await screen.findByRole('status')).textContent).toContain('今月の振替の上限に達しているため')
  expect(screen.queryByText(/連絡の締め切りを過ぎているため/)).toBeNull()
})

it('別の回へ切り替えた後の遅い結果は、窓も受付結果も別の回へ持ち込まない', async () => {
  let resolve!: (value: unknown) => void
  mock.save.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const view = render(<Harness />); const dialog = await open()
  fireEvent.click(dialog.getByRole('button', { name: '欠席にする' }))
  view.rerender(<Harness scope="slot-b" />)
  await act(async () => resolve({ data: { makeupCredit: { id: 'credit-a' }, reasonIfNone: null } }))
  expect(mock.saved).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByText(/欠席を受け付け、/)).toBeNull()
})

it('店を切り替えた描画の確定直後でも、前の店の遅い受付結果を持ち込まない', async () => {
  let resolve!: (value: unknown) => void
  mock.save.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const container = document.createElement('div'); document.body.appendChild(container)
  const root = createRoot(container)
  const environment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  try {
    await act(async () => root.render(<><Harness /></>))
    const dialog = await open()
    fireEvent.click(dialog.getByRole('button', { name: '欠席にする' }))
    let committed!: () => void
    const commit = new Promise<void>(done => { committed = done })
    function CommitProbe() {
      useLayoutEffect(() => { queueMicrotask(committed) }, [])
      return null
    }
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false)
    root.render(<><Harness accountId="b" scope="slot-b" /><CommitProbe /></>)
    await commit
    resolve({ data: { makeupCredit: { id: 'credit-a' }, reasonIfNone: null } })
    await Promise.resolve(); await Promise.resolve()
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', environment)
    await act(async () => {})
    expect(mock.saved).not.toHaveBeenCalled()
    expect(screen.queryByText(/欠席を受け付け、/)).toBeNull()
  } finally {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', environment)
    act(() => root.unmount()); container.remove()
  }
})
