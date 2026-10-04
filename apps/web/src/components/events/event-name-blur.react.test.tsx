// @vitest-environment happy-dom
/*
 * イベント作成・編集の「その場で確かめる入力」。
 * 名前欄を離れたとき（blur）に直し方を欄の下へ出す。文は保存時と同じ。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventDetail } from '@/lib/api'

const eventsGet = vi.hoisted(() => vi.fn())
const listSlots = vi.hoisted(() => vi.fn())
const tagsList = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: { ...actual.api, tags: { list: tagsList } },
    eventsApi: { ...actual.eventsApi, getEvent: eventsGet, listSlots },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    accounts: [],
    selectedAccount: null,
    selectedAccountId: 'acc-1',
    loading: false,
  }),
}))

vi.mock('@/components/shared/select', () => ({
  default: () => null,
}))

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import EventWizard from './event-wizard'
import EventForm from './event-form'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  tagsList.mockReset()
  tagsList.mockResolvedValue({ success: true, data: [] })
  eventsGet.mockReset()
  listSlots.mockReset()
  eventsGet.mockResolvedValue({ id: 'ev-1', name: '体験レッスン', questions_json: null, version: 1 })
  listSlots.mockResolvedValue({ items: [] })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function renderNode(node: React.ReactNode) {
  await act(async () => { root.render(node) })
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

describe('イベント作成（wizard）の名前欄を離れたときの確かめ', () => {
  it('空のまま離れると保存前に直し方が出て、入れると消える', async () => {
    await renderNode(<EventWizard accountId="acc-1" eventId={null} step={1} />)
    const input = host.querySelector('#ev-name') as HTMLInputElement
    if (!input) throw new Error('wizard name input not found')

    await act(async () => { fireEvent.blur(input) })
    expect(host.textContent).toContain('イベント名は必須です')

    await act(async () => { fireEvent.change(input, { target: { value: '夏の試食会' } }) })
    expect(host.textContent).not.toContain('イベント名は必須です')
  })
})

describe('イベント編集（form）の名前欄を離れたときの確かめ', () => {
  it('空にして離れると保存前に直し方が出て、戻すと消える', async () => {
    await renderNode(<EventForm accountId="acc-1" eventId="ev-1" />)
    const input = host.querySelector('input[placeholder="例: 第1回 AAA 説明会"]') as HTMLInputElement
    if (!input) throw new Error('form name input not found')
    expect(input.value).toBe('体験レッスン')

    await act(async () => { fireEvent.change(input, { target: { value: '' } }) })
    await act(async () => { fireEvent.blur(host.querySelector('input[placeholder="例: 第1回 AAA 説明会"]') as HTMLInputElement) })
    expect(host.textContent).toContain('イベント名は必須です')

    await act(async () => {
      fireEvent.change(host.querySelector('input[placeholder="例: 第1回 AAA 説明会"]') as HTMLInputElement, { target: { value: '体験レッスン' } })
    })
    expect(host.textContent).not.toContain('イベント名は必須です')
  })
})
