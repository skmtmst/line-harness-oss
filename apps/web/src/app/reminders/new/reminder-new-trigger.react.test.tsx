// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  foldersList: vi.fn(),
  friendFieldsList: vi.fn(),
  listEvents: vi.fn(),
  createDraft: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    folders: { list: fixture.foldersList },
    friendFields: { list: fixture.friendFieldsList },
    reminders: { createDraft: fixture.createDraft },
  },
  eventsApi: { listEvents: fixture.listEvents },
}))

import NewReminderPage from './page'

beforeEach(() => {
  fixture.foldersList.mockResolvedValue({ success: true, data: [] })
  fixture.friendFieldsList.mockResolvedValue({
    success: true,
    data: [
      { id: 'field-birthday', name: '誕生日', type: 'date' },
      { id: 'field-note', name: '自由メモ', type: 'text' },
      { id: 'field-contract-end', name: '契約終了日', type: 'datetime' },
    ],
  })
  fixture.listEvents.mockResolvedValue({
    items: [
      { id: 'event-1', name: '9月の説明会' },
      { id: 'event-2', name: '10月の体験会' },
    ],
    total: 2, limit: 100, sort: [],
  })
  fixture.createDraft.mockResolvedValue({
    success: true,
    data: { reminderId: 'r-new', versionId: 'v-1', versionNumber: 1, status: 'draft', settings: {}, lastTestStatus: null, lastTestedAt: null, publishedAt: null },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function fillName(value = 'テスト用リマインダ') {
  fireEvent.change(screen.getByPlaceholderText('例：Google Meet相談の前日案内'), { target: { value } })
}

describe('起点の実在候補選択', () => {
  it('友だち情報欄を選ぶと日付型の項目だけが選べる', async () => {
    render(<NewReminderPage />)
    fireEvent.click(screen.getByRole('button', { name: /友だち情報欄の日付/ }))

    await waitFor(() => expect(fixture.friendFieldsList).toHaveBeenCalledWith('account-1'))
    await waitFor(() => {
      const select = screen.getByLabelText('基準日に使う情報欄') as HTMLSelectElement
      const labels = [...select.options].map((option) => option.textContent)
      expect(labels).toContain('誕生日')
      expect(labels).toContain('契約終了日')
      expect(labels).not.toContain('自由メモ')
    })
  })

  it('情報欄を選ばないままでは作成しない', async () => {
    render(<NewReminderPage />)
    fillName()
    fireEvent.click(screen.getByRole('button', { name: /友だち情報欄の日付/ }))
    await screen.findByLabelText('基準日に使う情報欄')

    fireEvent.click(screen.getByRole('button', { name: '対象設定へ' }))
    await screen.findByText('基準日に使う友だち情報欄を選んでください')
    expect(fixture.createDraft).not.toHaveBeenCalled()
  })

  it('選んだ情報欄をtriggerFieldIdとして保存する', async () => {
    render(<NewReminderPage />)
    fillName()
    fireEvent.click(screen.getByRole('button', { name: /友だち情報欄の日付/ }))
    await waitFor(() => {
      const select = screen.getByLabelText('基準日に使う情報欄') as HTMLSelectElement
      expect([...select.options].some((option) => option.value === 'field-birthday')).toBe(true)
    })
    fireEvent.change(screen.getByLabelText('基準日に使う情報欄'), { target: { value: 'field-birthday' } })

    fireEvent.click(screen.getByRole('button', { name: '対象設定へ' }))
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalled())
    const settings = fixture.createDraft.mock.calls[0][0]
    expect(settings.triggerType).toBe('friend_field')
    expect(settings.triggerFieldId).toBe('field-birthday')
    expect(settings.triggerEventId).toBeNull()
  })

  it('イベントを選ぶと実在イベントの一覧から起点を選ぶ', async () => {
    render(<NewReminderPage />)
    fillName()
    fireEvent.click(screen.getByRole('button', { name: /フォーム回答日/ }))

    await waitFor(() => expect(fixture.listEvents).toHaveBeenCalled())
    await waitFor(() => {
      const select = screen.getByLabelText('基準日にするイベント') as HTMLSelectElement
      expect([...select.options].some((option) => option.value === 'event-2')).toBe(true)
    })
    fireEvent.change(screen.getByLabelText('基準日にするイベント'), { target: { value: 'event-2' } })

    fireEvent.click(screen.getByRole('button', { name: '対象設定へ' }))
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalled())
    const settings = fixture.createDraft.mock.calls[0][0]
    expect(settings.triggerType).toBe('event')
    expect(settings.triggerEventId).toBe('event-2')
    expect(settings.triggerFieldId).toBeNull()
  })

  it('イベントを選ばないままでは作成しない', async () => {
    render(<NewReminderPage />)
    fillName()
    fireEvent.click(screen.getByRole('button', { name: /フォーム回答日/ }))
    await screen.findByLabelText('基準日にするイベント')

    fireEvent.click(screen.getByRole('button', { name: '対象設定へ' }))
    await screen.findByText('基準日にするイベントを選んでください')
    expect(fixture.createDraft).not.toHaveBeenCalled()
  })
})

describe('未保存の入力保護', () => {
  it('入力途中で離れようとすると確認を出す', async () => {
    render(<NewReminderPage />)
    fillName()
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('何も入力していなければ確認を出さない', async () => {
    render(<NewReminderPage />)
    await screen.findByRole('button', { name: '対象設定へ' })
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
