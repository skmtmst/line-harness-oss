
// @vitest-environment happy-dom
/*
 * 配信対象のタグ候補の取得失敗と真の0件の分け方（監査 R581）。
 *
 * 再現: タグ候補GETを失敗させると、候補欄が空のまま「候補はありません」と
 * 出て、通信失敗が「タグが無い」と誤って伝わっていた。
 *
 * 見る筋書き:
 *   失敗 … 失敗の理由と「もう一度読み込む」が出て、候補欄は開かせない。
 *           再試行を押すと取り直し、書きかけ（配信名）は消えない。
 *   真の0件 … 「タグはまだありません」と作り先だけを案内する。
 *   復旧 … 候補が戻ると選べる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Tag } from '@line-crm/shared'

const createApi = vi.hoisted(() => vi.fn())
const updateApi = vi.hoisted(() => vi.fn())
const getApi = vi.hoisted(() => vi.fn())
const onRetryTags = vi.hoisted(() => vi.fn())
const fixture = vi.hoisted(() => ({ id: null as string | null, loading: false, recent: vi.fn() }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const emptyList = async () => ({ success: true, data: [] })
  return {
    ...actual,
    api: {
      ...actual.api,
      broadcasts: {
        ...actual.api.broadcasts,
        create: createApi,
        update: updateApi,
        get: getApi,
        list: fixture.recent,
        preflight: async () => ({ success: true, data: { audienceCount: 10 } }),
        previewCount: async () => ({ success: true, data: { count: 10 } }),
      },
      folders: { list: emptyList },
      scenarios: { list: emptyList },
      commonVars: { list: emptyList },
      friendFields: { list: emptyList },
      broadcastMessageAssets: { list: emptyList, upload: emptyList },
      templates: { list: emptyList },
      commonActions: { resources: async () => ({ success: true, data: [] }) },
      accountSettings: { getTestRecipients: async () => ({ success: true, data: [] }) },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/broadcasts/new',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.id, loading: fixture.loading }),
}))

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import BroadcastForm from './broadcast-form'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TAGS: Tag[] = [
  { id: 't-vip', name: 'VIP', color: '#e5484d', createdAt: '2026-01-01T00:00:00.000Z' },
]

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let step = 0; step < 12; step += 1) await Promise.resolve()
  })
}

async function renderForm(
  tags: Tag[],
  tagsStatus: 'loading' | 'ready' | 'error',
  step: 'basic' | undefined = 'basic',
) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <BroadcastForm
        tags={tags}
        tagsStatus={tagsStatus}
        onRetryTags={onRetryTags}
        onSuccess={() => {}}
        onCancel={() => {}}
        currentStep={step}
        onStepChange={() => {}}
      />,
    )
  })
  await flush()
}

async function rerenderForm(
  tags: Tag[],
  tagsStatus: 'loading' | 'ready' | 'error',
  step: 'basic' | undefined = 'basic',
) {
  await act(async () => {
    root.render(
      <BroadcastForm
        tags={tags}
        tagsStatus={tagsStatus}
        onRetryTags={onRetryTags}
        onSuccess={() => {}}
        onCancel={() => {}}
        currentStep={step}
        onStepChange={() => {}}
      />,
    )
  })
  await flush()
}

function unmount() {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
}


beforeEach(() => { fixture.id = null; fixture.loading = false; fixture.recent.mockReset() })
afterEach(() => { if (root) unmount() })
it('アカウント未確定では取得せず、読込中・失敗・本当の0件を分け、入力を残して再試行する', async () => {
  await renderForm([], 'ready')
  expect(fixture.recent).not.toHaveBeenCalled()
  expect(container.textContent).toContain('LINEアカウントを選ぶと')
  fixture.id = 'account-a'
  let reject!: (reason: Error) => void
  fixture.recent.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no }))
  await rerenderForm([], 'ready')
  expect(fixture.recent).toHaveBeenCalledWith({ accountId: 'account-a', limit: 3 })
  expect(container.textContent).toContain('最近の配信を読み込んでいます')
  expect(container.textContent).not.toContain('最近の配信はまだありません')
  await act(async () => { reject(new Error('network')) })
  expect(container.textContent).toContain('最近の配信を読み込めませんでした')
  expect(container.textContent).not.toContain('最近の配信はまだありません')
  const field = container.querySelector('input[placeholder="例：8月キャンペーンのお知らせ"]') as HTMLInputElement
  const { fireEvent } = await import('@testing-library/react')
  await act(async () => { fireEvent.change(field, { target: { value: '残す配信名' } }) })
  fixture.recent.mockResolvedValue({ success: true, data: [] })
  await act(async () => { [...container.querySelectorAll('button')].find(el => el.textContent?.trim() === 'もう一度読み込む')!.click() })
  expect(fixture.recent).toHaveBeenCalledTimes(2)
  expect(container.textContent).toContain('最近の配信はまだありません')
  expect(field.value).toBe('残す配信名')
})
it('切替前の遅い応答で別アカウントの最近の配信を出さない', async () => {
  fixture.id = 'account-a'
  let finish!: (value: unknown) => void
  fixture.recent.mockImplementationOnce(() => new Promise(done => { finish = done }))
  await renderForm([], 'ready')
  fixture.id = 'account-b'
  fixture.recent.mockResolvedValue({ success: true, data: [] })
  await rerenderForm([], 'ready')
  await act(async () => { finish({ success: true, data: [{ id: 'old', title: '前のアカウントの配信' }] }) })
  expect(container.textContent).not.toContain('前のアカウントの配信')
  expect(container.textContent).toContain('最近の配信はまだありません')
})
