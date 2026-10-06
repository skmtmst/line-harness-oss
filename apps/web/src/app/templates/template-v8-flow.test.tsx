// @vitest-environment happy-dom
/*
 * V8 通しの動き：テンプレートを作る→保存→公開する。
 * ボタンが押せる・窓が開いて閉じる・公開後に札が変わる、を確かめる。
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

document.documentElement.dataset.theme = 'v8'

function templateRow(id: string, name: string, publishedAt: string | null) {
  return {
    id, name, category: '', messageType: 'text', messageContent: '本文',
    folderId: null, question: null, questionStatus: 'draft', usageCount: 0,
    tapCount: 0, monthlySendCount: null, totalSendCount: null,
    hasDraft: publishedAt == null, publishedAt,
    createdAt: '2026-10-01T00:00:00+09:00', updatedAt: '2026-10-01T00:00:00+09:00',
  }
}

function detailRow(publishedVersion: number | null) {
  return {
    id: 't-2', name: '流れの型', messageType: 'text', messageContent: '本文',
    accountId: 'acc-1', folderId: null, category: '',
    publishedVersion, draftRevision: 2, usedBy: null, hasDraft: true,
  }
}

const mocks = vi.hoisted(() => ({
  rows: [templateRow('t-1', 'はじめの型', '2026-09-01T00:00:00+09:00')],
  list: vi.fn(async () => ({ success: true, data: mocks.rows })),
  foldersList: vi.fn(async () => ({ success: true, data: [] })),
  counts: vi.fn(async () => ({ success: true, data: {} })),
  create: vi.fn(async () => ({ success: true, data: { id: 't-new' } })),
  get: vi.fn(async () => ({ success: true, data: detailRow(null) })),
  versions: vi.fn(async () => ({ success: true, data: [] })),
  publish: vi.fn(async () => ({ success: true, data: { publishedVersion: 1 } })),
  accountId: 'acc-1',
  query: '',
  push: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.query),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    accounts: [{ id: 'acc-1', name: '然-NEN-TEST' }],
    selectedAccountId: mocks.accountId, selectedAccount: null, loading: false,
  }),
}))

vi.mock('@/lib/staff-capability', async (importOriginal: () => Promise<typeof import('@/lib/staff-capability')>) => {
  const actual = await importOriginal()
  return { ...actual, isOwnerOrAdmin: () => true, canEditFeature: () => true }
})

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      folders: { ...actual.api.folders, list: mocks.foldersList },
      broadcastMessageAssets: { ...actual.api.broadcastMessageAssets, counts: mocks.counts },
      templates: {
        ...actual.api.templates,
        list: mocks.list, create: mocks.create, get: mocks.get,
        versions: mocks.versions, publish: mocks.publish,
      },
    },
  }
})

import ToastHost, { clearToastsForTest } from '@/components/shared/toast'
import TemplatesListV8 from './list-v8'
import TemplateEditPage from './edit/page'
import TemplateDetailPage from './detail/page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function mount(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<>{node}<ToastHost /></>)
  })
}

beforeEach(() => {
  mocks.query = ''
  mocks.rows = [templateRow('t-1', 'はじめの型', '2026-09-01T00:00:00+09:00')]
  mocks.push.mockClear()
  mocks.create.mockClear()
  mocks.publish.mockClear()
  clearToastsForTest()
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  host.remove()
})

describe('V8 テンプレートの通し', () => {
  it('作る窓は開いて閉じる・種類を選ぶと作る画面へ進む', async () => {
    await mount(<TemplatesListV8 />)
    await screen.findByText('はじめの型')

    const openPicker = async () => {
      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: '＋ テンプレートを作る' })[0])
      })
      await screen.findByText('どの種類を作りますか')
    }
    await openPicker()
    // やめると閉じる（進まない）。
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    })
    await waitFor(() => expect(screen.queryByText('どの種類を作りますか')).toBeNull())
    expect(mocks.push).not.toHaveBeenCalled()

    // もう一度開いて種類を選ぶと作る画面へ進む。
    await openPicker()
    await screen.findByText('どの種類を作りますか')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^メッセージ / }))
    })
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/templates/edit'))
  })

  it('作る画面で名と本文を入れて保存すると知らせが出て一覧へ戻る', async () => {
    mocks.query = ''
    await mount(<TemplateEditPage />)
    const nameInput = document.getElementById('te-name') as HTMLInputElement
    expect(nameInput).not.toBeNull()
    fireEvent.change(nameInput, { target: { value: '流れの型' } })
    const bodyInput = document.getElementById('te-content') as HTMLTextAreaElement
    fireEvent.change(bodyInput, { target: { value: 'こんにちは' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    })
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    await screen.findByText('下書きを保存しました')
    expect(mocks.push).toHaveBeenCalledWith('/templates')
  })

  it('作る画面で保存して公開すると知らせが出て一覧へ戻る', async () => {
    mocks.query = ''
    await mount(<TemplateEditPage />)
    const nameInput = document.getElementById('te-name') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '流れの型' } })
    const bodyInput = document.getElementById('te-content') as HTMLTextAreaElement
    fireEvent.change(bodyInput, { target: { value: 'こんにちは' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存して公開' }))
    })
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1))
    await screen.findByText('公開しました')
    expect(mocks.push).toHaveBeenCalledWith('/templates')
  })

  it('公開する窓は開いて閉じる・公開すると札が変わる', async () => {
    mocks.query = 'id=t-2'
    await mount(<TemplateDetailPage />)
    await screen.findByText('流れの型')

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '公開する' })[0])
    })
    await screen.findByText('「流れの型」を公開する')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    })
    await waitFor(() => expect(screen.queryByText('「流れの型」を公開する')).toBeNull())
    expect(mocks.publish).not.toHaveBeenCalled()

    mocks.get.mockResolvedValueOnce({ success: true, data: { ...detailRow(1), hasDraft: false } })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '公開する' })[0])
    })
    const dialog = await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '公開する' }))
    })
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('「流れの型」を公開する')).toBeNull())
    // 読み直すと下書きの帯が消える（公開ずみ）。
    await waitFor(() => expect(screen.queryByText('まだ公開していません')).toBeNull())
  })
})
