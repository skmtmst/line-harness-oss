// @vitest-environment happy-dom
/*
 * 作成画面で送信・承認依頼・予約を終えたあとの行き先。
 *
 * 送信した配信と承認を頼んだ配信は新しい詳細（/broadcasts/detail?id=）へ、予約した配信は予約の画面へ進める。
 * 旧詳細（/broadcasts?id=）へは連れていかない。作成フォームの中身は別の試験が見るので、ここでは差し替える。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  tagsList: vi.fn(),
  onSuccess: null as null | ((broadcast: { id: string; status: string }) => void),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children),
}))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'admin' }))
vi.mock('@/lib/staff-capability', () => ({ canEditFeature: () => true }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }) }))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, api: { ...actual.api, tags: { ...actual.api.tags, list: mocks.tagsList } } }
})
vi.mock('@/components/broadcasts/broadcast-form', () => ({
  default: (props: { onSuccess: (broadcast: { id: string; status: string }) => void }) => {
    mocks.onSuccess = props.onSuccess
    return <div data-testid="broadcast-form" />
  },
}))

import NewBroadcastPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<NewBroadcastPage />)
  })
  await act(async () => {
    for (let round = 0; round < 6; round += 1) await Promise.resolve()
  })
}

beforeEach(() => {
  mocks.onSuccess = null
  mocks.tagsList.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

describe('作成を終えたあとの行き先', () => {
  it('送信した配信は新しい詳細へ進める（id は URL 用に符号化する）', async () => {
    await mount()
    expect(host.querySelector('[data-testid="broadcast-form"]')).not.toBeNull()
    act(() => mocks.onSuccess!({ id: 'b 1/2', status: 'sending' }))
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/broadcasts/detail?id=b%201%2F2')
  })

  it('承認を頼んだ配信も新しい詳細へ進める', async () => {
    await mount()
    act(() => mocks.onSuccess!({ id: 'b-2', status: 'pending_approval' }))
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/broadcasts/detail?id=b-2')
  })

  it('予約した配信は予約の画面へ進める', async () => {
    await mount()
    act(() => mocks.onSuccess!({ id: 'b-3', status: 'scheduled' }))
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/broadcasts/reserved?id=b-3')
  })
})
