// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { forgetStaffIdentity } from '@/lib/staff-identity-state'
import { PostsBoard } from './posts'

const api = vi.hoisted(() => ({ posts: vi.fn(), sync: vi.fn() }))
vi.mock('@/lib/restaurant-google-api', async original => ({
  ...await original<typeof import('@/lib/restaurant-google-api')>(),
  restaurantGoogleApi: { posts: api.posts, syncPosts: api.sync },
}))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, staff: { me: () => new Promise(() => {}) } } }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/restaurant-test/google' }))

const list = { success: true, posts: [], page: 1, perPage: 20, total: 0, counts: { all: 0, scheduled: 0, draft: 0, published: 0, attention: 0 } }
const renderBoard = (accountId = 'a') => render(<PostsBoard accountId={accountId} go={vi.fn()} />)
const button = () => screen.getByRole('button', { name: /Googleの状態を確認する|確認中…/ })
const stamp = () => screen.getByText(/最後に確かめた時刻/).closest('[role="status"]')
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-29T02:00:00Z'))
  verifiedStaffRole('owner')
  api.posts.mockResolvedValue(list)
  api.sync.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); forgetStaffIdentity(); vi.resetAllMocks(); vi.useRealTimers() })

it('画面を開いただけでは成功時刻を作らない', async () => {
  renderBoard()
  await screen.findByText('まだ投稿がありません')
  expect(stamp()?.textContent).toBe('最後に確かめた時刻：—（この画面ではまだ確認していません）')
  expect(api.sync).not.toHaveBeenCalled()
})
it('確認成功の時刻を画面内由来として表示し、次の確認中と失敗でも前回値を残す', async () => {
  renderBoard()
  fireEvent.click(button())
  await waitFor(() => expect(stamp()?.textContent).toBe('最後に確かめた時刻：10月29日 11:00（この画面での確認）'))
  const pending = deferred<{ success: true }>()
  api.sync.mockReturnValueOnce(pending.promise)
  vi.setSystemTime(new Date('2026-10-29T03:00:00Z'))
  fireEvent.click(button())
  expect(stamp()?.textContent).toContain('10月29日 11:00（この画面での確認）確認中…')
  await act(async () => { pending.reject(new Error('Googleの確認に失敗しました。')) })
  expect(await screen.findByText('Googleから投稿の状態を確認できませんでした。')).toBeTruthy()
  expect(stamp()?.textContent).toBe('最後に確かめた時刻：10月29日 11:00（この画面での確認）')
  fireEvent.click(button())
  await waitFor(() => expect(stamp()?.textContent).toContain('10月29日 12:00'))
})
it('成功ではない応答から時刻を作らず、同時に二重確認しない', async () => {
  const pending = deferred<{ success: boolean }>()
  api.sync.mockReturnValueOnce(pending.promise)
  renderBoard()
  fireEvent.click(button()); fireEvent.click(button())
  expect(api.sync).toHaveBeenCalledTimes(1)
  await act(async () => { pending.resolve({ success: false }) })
  expect(await screen.findByText('Googleから投稿の状態を確認できませんでした。')).toBeTruthy()
  expect(stamp()?.textContent).toContain('最後に確かめた時刻：—')
})
it('店舗を切り替えた後に前の確認が返っても、時刻と再読込を移さない', async () => {
  const pending = deferred<{ success: true }>()
  api.sync.mockReturnValueOnce(pending.promise)
  const view = renderBoard('a')
  await screen.findByText('まだ投稿がありません')
  fireEvent.click(button())
  view.rerender(<PostsBoard accountId="b" go={vi.fn()} />)
  await waitFor(() => expect(api.posts).toHaveBeenCalledWith('b', expect.anything()))
  const calls = api.posts.mock.calls.length
  await act(async () => { pending.resolve({ success: true }) })
  expect(stamp()?.textContent).toBe('最後に確かめた時刻：—（この画面ではまだ確認していません）')
  expect(api.posts.mock.calls.length).toBe(calls)
  view.rerender(<PostsBoard accountId="a" go={vi.fn()} />)
  expect(stamp()?.textContent).toContain('最後に確かめた時刻：—')
})
it('閉じた画面の遅い応答では再読込しない', async () => {
  const pending = deferred<{ success: true }>()
  api.sync.mockReturnValueOnce(pending.promise)
  const view = renderBoard()
  await screen.findByText('まだ投稿がありません')
  fireEvent.click(button()); view.unmount()
  const calls = api.posts.mock.calls.length
  await act(async () => { pending.resolve({ success: true }) })
  expect(api.posts.mock.calls.length).toBe(calls)
})
it('閲覧のみは共通の灰色と理由で確認を拒み、未知の役割では理由を作らない', () => {
  verifiedStaffRole('viewer')
  const view = renderBoard()
  expect(button().getAttribute('aria-disabled')).toBe('true')
  expect(document.getElementById(button().getAttribute('aria-describedby')!)?.textContent).toMatch(/閲覧のみ/)
  fireEvent.click(button()); fireEvent.keyDown(button(), { key: 'Enter' })
  expect(api.sync).not.toHaveBeenCalled()
  view.unmount(); verifiedStaffRole(null)
  renderBoard()
  expect(button()).toHaveProperty('disabled', true)
  expect(button().hasAttribute('aria-describedby')).toBe(false)
  expect(api.sync).not.toHaveBeenCalled()
})
