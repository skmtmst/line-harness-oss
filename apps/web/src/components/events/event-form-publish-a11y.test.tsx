// @vitest-environment happy-dom
/*
 * R218: 編集画面「3. 公開設定」の公開状態の回帰試験。
 *
 * 以前は色付きの素ボタンだけで、読み上げ（スクリーンリーダー）には
 * どちらが選ばれているか伝わらなかった。見る筋書き:
 *   1. 「下書き」「公開する」は同じ群のラジオ（input[type=radio]）
 *   2. 保存値に合わせて checked が付く
 *   3. 「公開する」を選ぶと選択が移る
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventDetail } from '@/lib/api'

const eventsGet = vi.hoisted(() => vi.fn())
const listSlots = vi.hoisted(() => vi.fn())
const updateEvent = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      tags: { list: async () => ({ success: true, data: [] }) },
    },
    eventsApi: {
      ...actual.eventsApi,
      getEvent: eventsGet,
      listSlots,
      updateEvent,
    },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    accounts: [{ id: 'acc-1', name: 'テスト店' }],
    selectedAccount: { id: 'acc-1', name: 'テスト店' },
    selectedAccountId: 'acc-1',
    loading: false,
  }),
}))

vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value, onChange, options }: {
    'aria-label'?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import EventForm from './event-form'

function serverRow(isPublished: number): EventDetail {
  return {
    id: 'ev-1',
    name: '体験レッスン',
    venue_name: null,
    venue_url: null,
    image_url: null,
    description: null,
    description_centered: 0,
    max_bookings_per_friend: null,
    requires_approval: 0,
    approval_deadline_hours: 24,
    cancel_deadline_hours_before: null,
    reminder_day_before_enabled: 1,
    reminder_hours_before: null,
    is_published: isPublished,
    sort_order: 0,
    confirmation_message_extra: null,
    reminder_message_extra: null,
    og_title: null,
    og_description: null,
    og_image_url: null,
    visible_tag_id: null,
    waitlist_enabled: 0,
    entry_cutoff_hours_before: null,
    target_type: 'single',
    account_ids: null,
    questions_json: null,
    version: 1,
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  eventsGet.mockReset()
  listSlots.mockReset()
  updateEvent.mockReset()
  listSlots.mockResolvedValue({ items: [] })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function renderForm(isPublished = 0) {
  eventsGet.mockResolvedValue(serverRow(isPublished))
  await act(async () => { root.render(<EventForm accountId="acc-1" eventId="ev-1" />) })
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
  // 「3. 公開設定」タブへ
  const tab = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('3. 公開設定'))
  expect(tab, '公開設定タブがある').toBeTruthy()
  await act(async () => {
    tab!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

function publishRadios(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[type="radio"][name="event-publish-state"]')]
}

describe('R218 公開状態は読み上げに伝わるラジオで選ぶ', () => {
  it('下書きのイベントでは「下書き」にチェックが付く', async () => {
    await renderForm(0)
    const radios = publishRadios()
    expect(radios).toHaveLength(2)
    const [draft, published] = radios
    expect(draft.value).toBe('draft')
    expect(draft.checked).toBe(true)
    expect(published.value).toBe('published')
    expect(published.checked).toBe(false)
    // 群には「公開状態」の名札が付いている
    const group = draft.closest('fieldset')
    expect(group?.querySelector('legend')?.textContent).toBe('公開状態')
  })

  it('公開中のイベントでは「公開する」にチェックが付き、選び直せる', async () => {
    await renderForm(1)
    const [draft, published] = publishRadios()
    expect(published.checked).toBe(true)

    await act(async () => {
      draft.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      for (let step = 0; step < 10; step += 1) await Promise.resolve()
    })
    const [draftAfter, publishedAfter] = publishRadios()
    expect(draftAfter.checked).toBe(true)
    expect(publishedAfter.checked).toBe(false)
  })
})
