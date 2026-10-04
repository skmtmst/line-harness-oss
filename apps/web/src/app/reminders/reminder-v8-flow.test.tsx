// @vitest-environment happy-dom
/**
 * V8 リマインダの通し試験（見た目のみ）。
 * 流れ：作る→下書き保存→一覧に戻ると増えている→登録者を足す。
 * 各段で「押せる・窓の開閉・保存後の知らせ・一覧の変化」を確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const pushMock = vi.hoisted(() => vi.fn())
const replaceMock = vi.hoisted(() => vi.fn())

const accountState = vi.hoisted(() => ({
  selectedAccountId: 'account-a',
  selectedAccount: null,
  accounts: [{ id: 'account-a', name: '本店' }],
  loading: false,
}))

const store = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  enrollees: [] as Array<Record<string, unknown>>,
  enrollCalls: [] as Array<{ reminderId: string; friendId: string; targetDate: string }>,
}))

const savedSettings = vi.hoisted(() => ({ settings: null as Record<string, unknown> | null }))
const createDraft = vi.hoisted(() => vi.fn(async (settings: Record<string, unknown>) => {
  savedSettings.settings = settings
  return { success: true, data: { reminderId: 'rm-new', versionNumber: 1 } }
}))
const getDraft = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  data: { reminderId: 'rm-new', versionNumber: 1, settings: savedSettings.settings ?? {} },
})))
const saveDraft = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  data: { reminderId: 'rm-new', versionNumber: 2 },
})))
const staffMe = vi.hoisted(() => vi.fn(async () => ({ success: true, data: { role: 'owner' } })))
const listRemindersApi = vi.hoisted(() => vi.fn(async () => ({ success: true, data: store.rows })))
const enrollApi = vi.hoisted(() => vi.fn(async (reminderId: string, friendId: string, targetDate: string) => {
  store.enrollCalls.push({ reminderId, friendId, targetDate })
  return { success: true, data: null }
}))
const listEnrollees = vi.hoisted(() => vi.fn(async () => ({ success: true, data: store.enrollees })))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
  usePathname: () => '/reminders',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  fetchApi: vi.fn(async (url: string) => {
    if (url.startsWith('/api/reminders?') || url === '/api/reminders') {
      return {
        success: true,
        data: { items: store.rows, total: store.rows.length, limit: 20, offset: 0 },
      }
    }
    if (url === '/api/list-stats') {
      return {
        success: true,
        data: { tags: {}, marks: {}, searches: {}, templates: {}, scenarios: {}, reminders: { total: 1, active: 1, waiting: 0, sentThisMonth: 0, failed: 0 } },
      }
    }
    return { success: true, data: {} }
  }),
  api: {
    reminders: {
      list: listRemindersApi,
      createDraft,
      enroll: enrollApi,
      registrants: { list: listEnrollees },
      update: vi.fn(async () => ({ success: true, data: null })),
      delete: vi.fn(async () => ({ success: true, data: null })),
      getDraft,
      saveDraft,
    },
    folders: { list: vi.fn(async () => ({ success: true, data: [], unfiledCount: 0 })) },
    listStats: { get: vi.fn(async () => ({ success: true, data: {} })) },
    staff: { me: staffMe },
  },
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => accountState,
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/components/shared/date-time-field', () => ({
  default: ({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void; [key: string]: unknown }) => (
    // 共通の日時選びの操作は部品自身の試験が持つ。ここでは値の受け渡しだけ見る。
    <input
      type="datetime-local"
      aria-label={typeof rest['aria-label'] === 'string' ? rest['aria-label'] : '日時'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

import RemindersPage from './page'
import NewReminderPage from './new/page'
import SingleFriendActions from '@/components/friends/single-friend-actions'
import { ReminderRegistrantsPanel } from './detail/registrants-panel'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const baseRow = {
  id: 'rm-1',
  name: '流れのリマインダ',
  description: null,
  isActive: true,
  triggerType: 'booking',
  deliveryMode: 'time',
  sendAtTime: '09:00',
  folderId: null,
  stepCount: 1,
  displayOrder: 0,
  hasFailure: false,
  failedCount: 0,
  plannedDeliveries: 0,
  nextScheduledAt: null,
  lifecycleStatus: 'published',
  timingSummary: '予約日の 1日前 09:00',
  createdAt: '2026-09-01 00:00',
  updatedAt: '2026-09-02 00:00',
}

function renderNode(node: React.ReactNode) {
  act(() => {
    root.render(<>{node}<ToastHost /></>)
  })
}

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

beforeEach(() => {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } }
  if (!g.crypto) g.crypto = {}
  if (!g.crypto.randomUUID) g.crypto.randomUUID = () => 'test-uuid-1'
  document.documentElement.dataset.theme = 'v8'
  store.rows = [{ ...baseRow }]
  store.enrollees = []
  store.enrollCalls.length = 0
  savedSettings.settings = null
  listRemindersApi.mockClear()
  createDraft.mockClear()
  enrollApi.mockClear()
  pushMock.mockClear()
  replaceMock.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  clearToastsForTest()
  delete document.documentElement.dataset.theme
  vi.clearAllMocks()
})

describe('V8 リマインダの通し：作る→一覧に戻ると増えている', () => {
  it('一覧の「＋ リマインダを作る」は作成へ進む', async () => {
    renderNode(<RemindersPage />)
    await flush()
    const createLink = screen.getAllByRole('link', { name: '＋ リマインダを作る' })[0]
    expect(createLink.getAttribute('href')).toBe('/reminders/new')
  })

  it('名前を入れて保存→知らせ→次へ→一覧に戻ると増えている', async () => {
    renderNode(<NewReminderPage />)
    await flush()

    const nameInput = host.querySelector('#v8-reminder-name') as HTMLInputElement
    expect(nameInput, 'リマインダ名の入力が見つかりません').toBeTruthy()
    fireEvent.change(nameInput, { target: { value: '流れの型2' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(createDraft).toHaveBeenCalledTimes(1))
    await screen.findByText('下書きを保存しました')

    fireEvent.click(screen.getByRole('button', { name: /次へ：/ }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/reminders/edit?id=rm-new&stage=target'))

    // 作ったものが一覧に足される。
    store.rows = [...store.rows, { ...baseRow, id: 'rm-new', name: '流れの型2', lifecycleStatus: 'draft' }]
    renderNode(<RemindersPage />)
    await flush()
    await screen.findByText('流れの型2')
  })
})

describe('V8 リマインダの通し：登録者を足す', () => {
  it('友だち側から選んで日時を入れて開始→知らせ→登録者に出る', async () => {
    const onDone = vi.fn()
    renderNode(
      <SingleFriendActions
        friendId="f-1"
        friendName="試す友だち"
        tags={[]}
        accountId="account-a"
        onDone={onDone}
      />,
    )
    await flush()

    // 「リマインダを開始」を開く。
    fireEvent.click(screen.getByRole('button', { name: 'リマインダを開始' }))
    await waitFor(() => expect(listRemindersApi).toHaveBeenCalled())

    // リマインダを選ぶ。
    const selectButton = screen.getByRole('button', { name: 'リマインダ' })
    fireEvent.click(selectButton)
    const listbox = await screen.findByRole('listbox')
    fireEvent.click(within(listbox).getByText('流れのリマインダ'))

    // ゴール日時を入れる。
    const dateInput = screen.getByLabelText('ゴール日時')
    fireEvent.change(dateInput, { target: { value: '2026-12-01T15:00' } })

    // 開始する→口が叩かれて知らせが出る。
    fireEvent.click(screen.getByRole('button', { name: '開始する' }))
    await waitFor(() => expect(enrollApi).toHaveBeenCalledTimes(1))
    expect(enrollApi).toHaveBeenCalledWith('rm-1', 'f-1', '2026-12-01T15:00:00+09:00')
    await screen.findByText('リマインダを開始しました')
    expect(onDone).toHaveBeenCalledTimes(1)

    // 登録者の一覧に出る。
    store.enrollees = [{
      id: 'en-1',
      friendId: 'f-1',
      friendName: '試す友だち',
      targetDate: '2026-12-01T06:00:00.000Z',
      status: 'active',
      lockVersion: 1,
      createdAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-03T00:00:00.000Z',
    }]
    renderNode(<ReminderRegistrantsPanel reminderId="rm-1" />)
    await flush()
    await screen.findByText('試す友だち')
    await screen.findByText(/登録 1件/)
  })
})
