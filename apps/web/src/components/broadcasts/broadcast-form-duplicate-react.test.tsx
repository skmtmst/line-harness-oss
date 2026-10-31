// @vitest-environment happy-dom
/*
 * 送信済み詳細の「複製して作る」（/broadcasts/new?duplicateFrom=<id>）を、本物の作成画面で確かめる。
 *
 * 見る筋書き:
 *   1. 元の配信を読み、題名と本文だけを引き継ぐ。配信方法は「過去の配信を複製」になる。
 *   2. 宛先・予約日時は引き継がない（確認しないまま別宛先・別日時に送れないように）。
 *   3. 元が読めないときは黙って空にせず理由を出す。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const createApi = vi.hoisted(() => vi.fn())
const getApi = vi.hoisted(() => vi.fn())

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

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
        update: vi.fn(),
        get: getApi,
        list: emptyList,
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
      accountSettings: { getTestRecipients: emptyList },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/broadcasts/new',
  useSearchParams: () => new URLSearchParams('duplicateFrom=source-1'),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }),
}))

import BroadcastForm from './broadcast-form'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let step = 0; step < 12; step += 1) await Promise.resolve()
  })
}

function sentBroadcast() {
  return {
    id: 'source-1',
    lineAccountId: 'acc-1',
    title: '夏の告知',
    messageType: 'text',
    messageContent: '元の本文',
    messageBubbles: null,
    targetType: 'tag',
    targetTagId: 'tag-vip',
    segmentConditions: null,
    scheduledAt: '2099-08-01T01:00:00.000Z',
    status: 'sent',
    version: 3,
  }
}

async function renderForm() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<BroadcastForm currentStep="basic" tags={[{ id: 'tag-vip', name: 'VIP' } as never]} onSuccess={() => {}} onCancel={() => {}} />)
  })
  await flush()
}

function titleInput(): HTMLInputElement {
  return container.querySelector('input[placeholder="例：8月キャンペーンのお知らせ"]') as HTMLInputElement
}

function methodRadio(value: string): HTMLInputElement {
  return container.querySelector(`input[name="broadcast-delivery-method"][value="${value}"]`) as HTMLInputElement
}

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
})

describe('同じ設定で作り直す', () => {
  it('元の配信を読み、題名と本文を引き継いで「過去の配信を複製」として始める', async () => {
    getApi.mockResolvedValue({ success: true, data: sentBroadcast() })
    createApi.mockResolvedValue({ success: true, data: { id: 'draft-new', version: 1 } })
    await renderForm()
    expect(getApi).toHaveBeenCalledExactlyOnceWith('source-1')
    expect(titleInput().value).toBe('夏の告知（複製）')
    expect(methodRadio('duplicate').checked).toBe(true)

    const save = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '下書きを保存する')!
    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(createApi).toHaveBeenCalledTimes(1)
    const payload = createApi.mock.calls[0][0]
    expect(payload).toMatchObject({ title: '夏の告知（複製）', messageContent: '元の本文', lineAccountId: 'acc-1' })
    // 宛先・予約日時は写さない。
    expect(payload).toMatchObject({ targetType: 'tag', targetTagId: '', draftTargetMode: 'unselected' })
    expect(payload.segmentConditions ?? null).toBeNull()
    expect(payload.scheduledAt).toBeNull()
  })

  it('元が読めないときは空のまま理由を出す', async () => {
    getApi.mockResolvedValue({ success: false, error: 'not found' })
    await renderForm()
    expect(container.textContent).toContain('元の配信を読み込めませんでした。作り直す配信を選び直してください。')
    expect(titleInput().value).toBe('')
    expect(methodRadio('duplicate').checked).toBe(false)
  })

  it('読み込みが失敗で終わったときも、黙って空にせず理由を出す', async () => {
    getApi.mockRejectedValue(new Error('offline'))
    await renderForm()
    expect(container.textContent).toContain('元の配信を読み込めませんでした。作り直す配信を選び直してください。')
  })
})
