// @vitest-environment happy-dom
/**
 * リマインダの作る・編集で保存がぶつかったとき（409）の道（動きの点検 16 番）。
 * 共通の save-conflict の帯（k32cn）と「違いを比べる／最新を読み込んで続ける」が出て、
 * 入力は捨てず、読み込むと最新の版で続けられる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const pushMock = vi.hoisted(() => vi.fn())

const SETTINGS = vi.hoisted(() => ({
  name: '予約前日のご案内',
  description: null,
  lineAccountId: 'account-a',
  folderId: null,
  triggerType: 'booking',
  deliveryMode: 'time',
  triggerFieldId: null,
  triggerEventId: null,
  repeatYearly: false,
  leapYearPolicy: 'feb28',
  triggerOffsetMinutes: null,
  sendAtTime: null,
  targetTagId: null,
  targetCondition: null,
  stopConditions: { bookingCancelled: true, supportMarkCompleted: true, daysAfterTarget: 7, friendBlocked: true },
  steps: [],
}))

const version = (versionId: string, updatedAt: string, settings: Record<string, unknown>) => ({
  reminderId: 'rm-1',
  versionId,
  versionNumber: 1,
  status: 'draft',
  settings,
  lastTestStatus: null,
  lastTestedAt: null,
  publishedAt: null,
  updatedAt,
})

const latest = vi.hoisted(() => ({ settings: null as Record<string, unknown> | null }))
const createDraft = vi.hoisted(() => vi.fn())
const getDraft = vi.hoisted(() => vi.fn())
const saveDraft = vi.hoisted(() => vi.fn())

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/reminders/new',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    data: unknown
    constructor(status: number, message: string, data?: unknown) {
      super(message)
      this.status = status
      this.data = data ?? null
    }
  },
  fetchApi: vi.fn(async () => ({ success: true, data: {} })),
  eventsApi: { listEvents: vi.fn(async () => ({ success: true, data: { items: [] } })) },
  api: {
    reminders: {
      createDraft,
      getDraft,
      saveDraft,
      previewDraft: vi.fn(async () => ({ success: true, data: null })),
      validateDraft: vi.fn(async () => ({ success: true, data: null })),
      testRecipient: vi.fn(async () => ({ success: true, data: null })),
    },
    folders: { list: vi.fn(async () => ({ success: true, data: [], unfiledCount: 0 })) },
    friendFields: { list: vi.fn(async () => ({ success: true, data: [] })) },
    staff: { me: vi.fn(async () => ({ success: true, data: { role: 'owner' } })) },
  },
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, accounts: [], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

import { ApiError } from '@/lib/api'
import NewReminderV8 from './new/new-v8'
import ReminderEditV8 from './edit/edit-v8'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

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

const conflictError = () => new (ApiError as unknown as new (s: number, m: string, d?: unknown) => Error)(409, 'conflict', { updatedAt: '' })

beforeEach(() => {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } }
  if (!g.crypto) g.crypto = {}
  if (!g.crypto.randomUUID) g.crypto.randomUUID = () => 'test-uuid-1'
  document.documentElement.dataset.theme = 'v8'
  latest.settings = { ...SETTINGS, name: '予約前日のご案内（マサト）' }
  createDraft.mockImplementation(async (settings: Record<string, unknown>) => ({ success: true, data: version('v-1', '2026-10-07 05:00:00', settings) }))
  getDraft.mockImplementation(async () => ({ success: true, data: version('v-2', '2026-10-07 05:02:00', latest.settings!) }))
  saveDraft.mockImplementation(async () => { throw conflictError() })
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

describe('リマインダを作る：続けて保存したときにぶつかる', () => {
  it('2回目の保存は最後に保存した版を送り、409 なら帯と比べる・読み込むを出す', async () => {
    renderNode(<NewReminderV8 />)
    await flush()
    const nameInput = host.querySelector('#v8-reminder-name') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '予約前日のご案内' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(createDraft).toHaveBeenCalledTimes(1))

    // 名前を直してもう一度保存。最後に保存した版（v-1）を送る。
    fireEvent.change(nameInput, { target: { value: '予約前日のご案内（直した）' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1))
    expect(saveDraft.mock.calls[0][0]).toBe('rm-1')
    expect(saveDraft.mock.calls[0][2]).toEqual({ expectedVersionId: 'v-1', expectedUpdatedAt: '2026-10-07 05:00:00' })
    // 保存の前に最新を読み直して重ねない（相手の変更を黙って上書きしない）
    expect(getDraft).not.toHaveBeenCalled()

    const band = await screen.findByRole('alert')
    expect(band.getAttribute('data-design-node')).toBe('k32cn')
    expect(within(band).getByText('ほかの人が先にリマインダ「予約前日のご案内（直した）」を保存しました')).toBeTruthy()
    // 入力は捨てない
    expect(nameInput.value).toBe('予約前日のご案内（直した）')

    // 違いを比べる → 名前の違いが出る。画面は書き換えない。
    fireEvent.click(within(band).getByRole('button', { name: '違いを比べる' }))
    const dialog = await screen.findByRole('dialog', { name: '最新の保存と比べる' })
    expect(within(dialog).getByText(/リマインダ名が違います（最新「予約前日のご案内（マサト）」／あなた「予約前日のご案内（直した）」）/)).toBeTruthy()
    expect(nameInput.value).toBe('予約前日のご案内（直した）')

    // 最新を読み込んで続ける → 最新の名前になり、帯が消える。次の保存は最新の版（v-2）を送る。
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '最新を読み込んで続ける' }))
    })
    await flush()
    expect(nameInput.value).toBe('予約前日のご案内（マサト）')
    expect(screen.queryByRole('alert')).toBeNull()
    saveDraft.mockImplementation(async () => ({ success: true, data: version('v-3', '2026-10-07 05:05:00', latest.settings!) }))
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2))
    expect(saveDraft.mock.calls[1][2]).toEqual({ expectedVersionId: 'v-2', expectedUpdatedAt: '2026-10-07 05:02:00' })
  })
})

describe('リマインダの編集：保存がぶつかる', () => {
  it('409 で共通の帯（k32cn）を出し、比べる窓に違いを出す', async () => {
    getDraft.mockImplementationOnce(async () => ({ success: true, data: version('v-1', '2026-10-07 05:00:00', { ...SETTINGS }) }))
    renderNode(<ReminderEditV8 reminderId="rm-1" stage="basics" />)
    await flush()
    const nameInput = host.querySelector('#v8-reminder-name') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '予約前日のご案内（直した）' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1))
    const band = await screen.findByRole('alert')
    expect(band.getAttribute('data-design-node')).toBe('k32cn')
    expect(band.hasAttribute('data-save-conflict')).toBe(true)
    fireEvent.click(within(band).getByRole('button', { name: '違いを比べる' }))
    const dialog = await screen.findByRole('dialog', { name: '最新の保存と比べる' })
    expect(within(dialog).getByText(/リマインダ名が違います/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '最新を読み込んで続ける' }))
    })
    await flush()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
