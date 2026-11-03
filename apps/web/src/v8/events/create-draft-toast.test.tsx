// @vitest-environment happy-dom
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPageAction } from '@/test-utils/page-action'

const apiMocks = vi.hoisted(() => ({
  create: vi.fn(), slots: vi.fn(), update: vi.fn(), read: vi.fn(), folders: vi.fn(), push: vi.fn(),
  navigate: null as null | ((href: string) => void),
}))
vi.hoisted(() => { process.env.NEXT_PUBLIC_API_URL = 'http://worker.test' })
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, eventsApi: { ...actual.eventsApi, createEvent: apiMocks.create, createSlots: apiMocks.slots, updateEvent: apiMocks.update },
    fetchApi: apiMocks.read, api: { ...actual.api, folders: { ...actual.api.folders, list: apiMocks.folders } } }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => { apiMocks.push(href); apiMocks.navigate?.(href) }, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock('next/link', () => ({ default: (props: React.PropsWithChildren<{ href: string; prefetch?: boolean }>) => {
  const anchorProps = { ...props }
  delete anchorProps.prefetch
  return <a {...anchorProps} />
} }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/use-running-version', () => ({ useRunningVersion: () => ({ detail: null, statusText: '確認できませんでした' }) }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
import EventsCreate from './create'
import EventsList from './list'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'

let stored: Record<string, unknown>
function Routes() {
  const [page, setPage] = useState('create')
  apiMocks.navigate = href => {
    window.history.pushState(null, '', href)
    setPage('list')
  }
  return <>{page === 'create' ? <EventsCreate /> : <EventsList />}<ToastHost /></>
}
const notices = () => screen.getByRole('status', { name: '知らせ' })
function fill() {
  fireEvent.change(screen.getByLabelText('イベント名'), { target: { value: '確認用の下書き' } })
  fireEvent.change(screen.getByLabelText('定員'), { target: { value: '2' } })
}
async function listReady() {
  await waitFor(() => expect(apiMocks.push).toHaveBeenCalledTimes(1))
  await screen.findByText('確認用の下書き')
  expect(screen.queryByLabelText('イベント名')).toBeNull()
  expect(window.location.pathname).toBe('/events')
  expect(apiMocks.push).toHaveBeenCalledWith('/events?highlight=draft-fixture')
  expect(document.querySelector('[data-row-id="draft-fixture"]')).toBeTruthy()
}
async function publish() {
  fireEvent.click(screen.getByRole('button', { name: '公開する' }))
  const dialog = await screen.findByRole('dialog', { name: 'イベントを公開する' })
  fireEvent.click(within(dialog).getByRole('button', { name: '公開する' }))
}
beforeEach(() => {
  vi.clearAllMocks()
  clearToastsForTest()
  Element.prototype.scrollIntoView = vi.fn()
  window.history.replaceState(null, '', '/events/new')
  window.dispatchEvent(new PopStateEvent('popstate'))
  document.documentElement.dataset.theme = 'v8'
  apiMocks.navigate = null
  stored = { id: 'draft-fixture', name: '確認用の下書き', description: null, venue_name: null, venue_url: null, image_url: null,
    description_centered: 0, max_bookings_per_friend: 1, requires_approval: 0, approval_deadline_hours: 24,
    cancel_deadline_hours_before: 24, reminder_day_before_enabled: 0, reminder_hours_before: null,
    is_published: 0, lifecycle_status: 'draft', folderId: null, sort_order: 1, created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z', version: 1, next_slot_starts_at: null, total_capacity: 2,
    total_active: 0, pending_count: 0, visible_tag_id: null, visible_tag_name: null }
  apiMocks.create.mockImplementation(async () => stored)
  apiMocks.slots.mockImplementation(async (_account, eventId, slots) => ({ items: [{ ...slots[0], id: 'slot-fixture', event_id: eventId, version: 1 }] }))
  apiMocks.read.mockImplementation(async () => ({ items: [stored], total: 1, summary: null }))
  apiMocks.folders.mockResolvedValue({ success: true, data: [], unfiledCount: 0 })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('実通信は使わない') }))
})
afterEach(() => { cleanup(); clearToastsForTest(); vi.unstubAllGlobals(); delete document.documentElement.dataset.theme })

describe('下書き保存後の知らせと一覧への移動', () => {
  it('本体と初回枠が保存できたとき、実一覧へ移っても知らせが1件残る', async () => {
    render(<Routes />); fill(); fireEvent.click(getPageAction({ name: '下書きを保存' }))
    await listReady()
    expect(within(notices()).getAllByText('下書きを保存しました')).toHaveLength(1)
    expect(notices().querySelectorAll('[data-toast]')).toHaveLength(1)
    expect(apiMocks.create).toHaveBeenCalledTimes(1)
    expect(apiMocks.create.mock.calls[0]).toEqual(['account-a', expect.objectContaining({ is_published: 0, name: '確認用の下書き' })])
    expect(apiMocks.slots).toHaveBeenCalledTimes(1)
    expect(apiMocks.slots.mock.calls[0][2][0]).toMatchObject({ capacity: 2, client_key: 'first-slot:draft-fixture' })
  })

  it('枠が失敗したら通知せず、入力と完了分・残りを保ち、移動しない', async () => {
    apiMocks.slots.mockRejectedValueOnce(new Error('fixture slot unavailable'))
    render(<Routes />); fill(); fireEvent.click(getPageAction({ name: '下書きを保存' }))
    await screen.findByText('残り：最初の予約枠')
    expect(document.querySelector('[data-save-state="partial"]')?.textContent).toContain('イベント本体（下書き）')
    expect((screen.getByLabelText('イベント名') as HTMLInputElement).value).toBe('確認用の下書き')
    expect(notices().textContent).toBe('')
    expect(apiMocks.push).not.toHaveBeenCalled()
  })

  it('公開成功では下書きと知らせず、明示確認後だけ公開して移動する', async () => {
    stored.is_published = 1; stored.lifecycle_status = 'published'
    render(<Routes />); fill(); expect(apiMocks.create).not.toHaveBeenCalled(); await publish(); await listReady()
    expect(apiMocks.create.mock.calls[0][1].is_published).toBe(1)
    expect(notices().textContent).not.toContain('下書きを保存しました')
  })

  it('本体だけ公開済みの復旧で下書き保存を押しても、公開を維持し下書きと知らせない', async () => {
    stored.is_published = 1; stored.lifecycle_status = 'published'
    apiMocks.slots.mockRejectedValueOnce(new Error('fixture slot unavailable'))
    render(<Routes />); fill(); await publish(); await screen.findByText('残り：最初の予約枠')
    const dialog = screen.getByRole('dialog', { name: 'イベントを公開する' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(getPageAction({ name: '下書きを保存' })); await listReady()
    expect(apiMocks.create).toHaveBeenCalledTimes(1)
    expect(apiMocks.update).not.toHaveBeenCalled()
    expect(apiMocks.slots).toHaveBeenCalledTimes(2)
    expect(notices().textContent).toBe('')
  })

  it('枠だけ再試行して成功したとき、重複作成せず知らせ1件で移動する', async () => {
    apiMocks.slots.mockRejectedValueOnce(new Error('fixture slot unavailable'))
    render(<Routes />); fill(); fireEvent.click(getPageAction({ name: '下書きを保存' }))
    await screen.findByText('残り：最初の予約枠'); fireEvent.click(screen.getByRole('button', { name: '残りだけもう一度' })); await listReady()
    expect(apiMocks.create).toHaveBeenCalledTimes(1)
    expect(apiMocks.slots).toHaveBeenCalledTimes(2)
    expect(within(notices()).getAllByText('下書きを保存しました')).toHaveLength(1)
    expect(notices().querySelectorAll('[data-toast]')).toHaveLength(1)
  })

  it('保存待ちの二度押しも本体1回・初回枠1回・知らせ1件にする', async () => {
    let resolve!: (value: Record<string, unknown>) => void
    apiMocks.create.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    render(<Routes />); fill(); const button = getPageAction({ name: '下書きを保存' }); fireEvent.click(button); fireEvent.click(button)
    expect(apiMocks.create).toHaveBeenCalledTimes(1)
    await act(async () => { resolve(stored) }); await listReady()
    expect(apiMocks.slots).toHaveBeenCalledTimes(1)
    expect(notices().querySelectorAll('[data-toast]')).toHaveLength(1)
  })

  it.each([undefined, null])('公開状態が不明な応答では下書きと断定しない（%s）', async state => {
    stored.is_published = state
    render(<Routes />); fill(); fireEvent.click(getPageAction({ name: '下書きを保存' })); await listReady()
    expect(notices().textContent).toBe('')
  })

  it.each(['failed', 'null'])('作成本体の結果を確認できないとき、通知・再作成・移動をしない（%s）', async result => {
    if (result === 'failed') apiMocks.create.mockRejectedValueOnce(new Error('fixture response lost'))
    else apiMocks.create.mockResolvedValueOnce(null)
    render(<Routes />); fill(); fireEvent.click(getPageAction({ name: '下書きを保存' }))
    await screen.findByText(/イベントの作成結果を確認できませんでした。/)
    expect((getPageAction({ name: '下書きを保存' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(getPageAction({ name: '下書きを保存' }))
    expect(apiMocks.create).toHaveBeenCalledTimes(1)
    expect(apiMocks.slots).not.toHaveBeenCalled()
    expect(apiMocks.push).not.toHaveBeenCalled()
    expect(notices().textContent).toBe('')
  })
})
