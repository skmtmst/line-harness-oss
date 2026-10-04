// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiBroadcast } from '@/lib/api'

const mocks = vi.hoisted(() => ({ accountId: 'acc-1' as string | null, loading: false, list: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const empty = async () => ({ success: true, data: [] })
  return { ...actual, api: { ...actual.api,
    broadcasts: { ...actual.api.broadcasts, list: mocks.list },
    folders: { list: empty }, scenarios: { list: empty }, commonVars: { list: empty }, friendFields: { list: empty },
    broadcastMessageAssets: { list: empty }, templates: { list: empty },
    commonActions: { resources: async () => ({ success: true, data: { commonActions: [] } }) },
    accountSettings: { getTestRecipients: empty },
  } }
})
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/broadcasts/new', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: mocks.accountId, loading: mocks.loading }) }))

import BroadcastForm from './broadcast-form'
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
function broadcast(id: string, title: string): ApiBroadcast {
  return { id, title, status: 'draft', messageType: 'text', totalCount: 0 } as ApiBroadcast
}
function deferred() {
  let resolve!: (value: { success: true; data: ApiBroadcast[] }) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<{ success: true; data: ApiBroadcast[] }>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function render() {
  await act(async () => {
    root.render(<BroadcastForm tags={[]} currentStep="basic" onStepChange={() => {}} onSuccess={() => {}} onCancel={() => {}} />)
    for (let i = 0; i < 12; i++) await Promise.resolve()
  })
}
beforeEach(() => {
  vi.useFakeTimers()
  mocks.accountId = 'acc-1'
  mocks.loading = false
  mocks.list.mockReset().mockResolvedValue({ success: true, data: [] })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('最近の配信の状態とアカウント切替', () => {
  it('読み込み中を0件と取り違えず、取得は今のアカウントの3件に限る', async () => {
    mocks.list.mockReturnValue(deferred().promise)
    await render()
    expect(container.textContent).toContain('最近の配信を読み込んでいます')
    expect(container.textContent).not.toContain('最近の配信はまだありません')
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ accountId: 'acc-1', limit: 3 })
  })

  it('取得できた0件だけを「まだありません」と表示する', async () => {
    await render()
    expect(container.textContent).toContain('最近の配信はまだありません')
    expect(container.textContent).not.toContain('最近の配信を読み込めませんでした')
  })

  it.each(['api', 'network'])('%sの失敗は0件にせず、再取得しても書きかけの名前を残す', async (failure) => {
    if (failure === 'api') mocks.list.mockResolvedValueOnce({ success: false, error: '取得失敗' })
    else mocks.list.mockRejectedValueOnce(new Error('通信失敗'))
    await render()
    expect(container.textContent).toContain('最近の配信を読み込めませんでした')
    expect(container.textContent).not.toContain('最近の配信はまだありません')
    const title = container.querySelector<HTMLInputElement>('input[placeholder="例：8月キャンペーンのお知らせ"]')!
    await act(async () => { fireEvent.change(title, { target: { value: '書きかけの配信' } }) })
    mocks.list.mockResolvedValueOnce({ success: true, data: [broadcast('b-1', '届いた配信')] })
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'もう一度読み込む')!
    await act(async () => { fireEvent.click(retry) })
    expect(container.textContent).toContain('届いた配信')
    expect(container.textContent).not.toContain('最近の配信を読み込めませんでした')
    expect(title.value).toBe('書きかけの配信')
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it.each(['success', 'error'])('切替前に始めた遅い%s応答で、切替後の配信を上書きしない', async (outcome) => {
    const old = deferred()
    mocks.list.mockReturnValueOnce(old.promise)
    await render()
    mocks.accountId = 'acc-2'
    mocks.list.mockResolvedValueOnce({ success: true, data: [broadcast('b-2', '切替後の配信')] })
    await render()
    await act(async () => {
      if (outcome === 'success') old.resolve({ success: true, data: [broadcast('b-1', '切替前の配信')] })
      else old.reject(new Error('古い通信の失敗'))
    })
    expect(container.textContent).toContain('切替後の配信')
    expect(container.textContent).not.toContain('切替前の配信')
    expect(container.textContent).not.toContain('最近の配信を読み込めませんでした')
    expect(mocks.list).toHaveBeenLastCalledWith({ accountId: 'acc-2', limit: 3 })
  })

  it('切替後の読み込み中は、切替前の複製ボタンを残さない', async () => {
    mocks.list.mockResolvedValueOnce({ success: true, data: [broadcast('b-1', '切替前の配信')] })
    await render()
    expect(container.textContent).toContain('切替前の配信')
    mocks.accountId = 'acc-2'
    mocks.list.mockReturnValueOnce(deferred().promise)
    await render()
    expect(container.textContent).toContain('最近の配信を読み込んでいます')
    expect(container.textContent).not.toContain('切替前の配信')
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === '複製する')).toBe(false)
  })

  it('アカウントの確認中と未選択では、全アカウントの配信を取得しない', async () => {
    mocks.accountId = null
    mocks.loading = true
    await render()
    expect(container.textContent).toContain('最近の配信を読み込んでいます')
    mocks.loading = false
    await render()
    expect(container.textContent).toContain('LINE公式アカウントを選ぶと最近の配信を確認できます')
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
