// @vitest-environment happy-dom
/*
 * V8 通しの動き：一斉配信を作る→下書き保存→予約を取り消す。
 * ボタンが押せる・保存後に知らせが出る・一覧に戻ると増えている、
 * 取り消しの窓が開いて閉じる・取り消すと下書きに戻る、を確かめる。
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

document.documentElement.dataset.theme = 'v8'

function draftRow(id: string, title: string) {
  return {
    id, title, status: 'draft', messageType: 'text', scheduledAt: null,
    displayStatus: 'draft', displayStatusLabel: '下書き',
    createdAt: '2026-10-01T00:00:00+09:00', updatedAt: '2026-10-01T00:00:00+09:00',
    recipientCount: 0, folderId: null,
  }
}

function scheduledRow(id: string, title: string) {
  return {
    ...draftRow(id, title),
    status: 'scheduled', scheduledAt: '2026-10-10T10:00:00+09:00',
    displayStatus: 'scheduled', displayStatusLabel: '予約済み',
  }
}

const mocks = vi.hoisted(() => ({
  listRows: [draftRow('b-1', 'はじめの配信')] as Array<ReturnType<typeof draftRow>>,
  list: vi.fn(async () => ({
    success: true, data: mocks.listRows, kpis: null, statusCounts: null,
    pagination: { total: mocks.listRows.length },
  })),
  tagsList: vi.fn(async () => ({ success: true, data: [] })),
  scenariosList: vi.fn(async () => ({ success: true, data: [] })),
  foldersList: vi.fn(async () => ({ success: true, data: [] })),
  overview: vi.fn(async () => ({
    success: true, data: { delivery: { quotaLimit: 1000, quotaUsed: 10 } },
  })),
  create: vi.fn(async () => ({ success: true, data: { ...draftRow('b-new', '流れの配信'), status: 'draft' } })),
  get: vi.fn(async () => ({ success: true, data: scheduledRow('b-2', '予約ずみ配信') })),
  getInsight: vi.fn(async () => ({ success: false, error: 'なし' })),
  approvalGet: vi.fn(async () => ({
    success: true,
    data: {
      approval: {
        status: 'none', requestedByStaffId: null, requestedAt: null,
        approverStaffId: null, note: null, decidedByStaffId: null,
        decidedAt: null, rejectReason: null, confirmedCount: null,
      },
      gate: { required: false, recipientCount: 0, threshold: 0, singleOperator: true, operatorCount: 1 },
      viewer: { isApprover: false, canApprove: false, isRequester: false },
    },
  })),
  cancelReservation: vi.fn(async () => ({ success: true, data: {} })),
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

vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'admin' }))
vi.mock('@/lib/staff-capability', () => ({ canEditFeature: () => true }))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: mocks.accountId, selectedAccount: null, loading: false }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { role: 'owner' } }) },
      tags: { ...actual.api.tags, list: mocks.tagsList },
      scenarios: { ...actual.api.scenarios, list: mocks.scenariosList },
      folders: { ...actual.api.folders, list: mocks.foldersList },
      dashboard: { ...actual.api.dashboard, overview: mocks.overview },
      broadcasts: {
        ...actual.api.broadcasts,
        list: mocks.list,
        create: mocks.create,
        get: mocks.get,
        getInsight: mocks.getInsight,
        cancelReservation: mocks.cancelReservation,
        approval: { ...actual.api.broadcasts.approval, get: mocks.approvalGet },
      },
    },
  }
})

import ToastHost, { clearToastsForTest } from '@/components/shared/toast'
import BroadcastListV8 from './list-v8'
import BroadcastDetailPage from './detail/page'

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

function unmount() {
  act(() => {
    root.unmount()
  })
  host.remove()
}

beforeEach(() => {
  // 予約を取り消せるオーナーとして操作する。実APIや他の試験の役割に依存させない。
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key === 'lh_staff_role' ? 'owner' : null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  })
  mocks.query = ''
  mocks.listRows = [draftRow('b-1', 'はじめの配信')]
  mocks.push.mockClear()
  mocks.create.mockClear()
  mocks.cancelReservation.mockClear()
  clearToastsForTest()
})

afterEach(() => {
  unmount()
  vi.unstubAllGlobals()
})

describe('V8 一斉配信の通し', () => {
  it('作る→下書き保存→知らせ→一覧に戻ると増えている', async () => {
    await mount(<BroadcastListV8 />)
    await screen.findByText('はじめの配信')

    // 作る入口を押すと作る面が出る。
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '＋ 配信を作る' })[0])
    })
    await screen.findByPlaceholderText('例：8月キャンペーンのお知らせ')

    // 題と本文を入れて下書きを保存する。
    fireEvent.change(screen.getByPlaceholderText('例：8月キャンペーンのお知らせ'), {
      target: { value: '流れの配信' },
    })
    fireEvent.change(screen.getByPlaceholderText('テキストを入力'), {
      target: { value: 'こんにちは' },
    })
    // 宛先は友だち全員にする。
    await act(async () => {
      fireEvent.click(screen.getByText('友だち全員に配信する'))
    })
    mocks.listRows = [draftRow('b-1', 'はじめの配信'), draftRow('b-new', '流れの配信')]
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    })
    // 保存の知らせが出て、作る面が閉じて、一覧に戻ると増えている。
    await screen.findByText('下書きを保存しました。')
    await waitFor(() => expect(screen.queryByPlaceholderText('例：8月キャンペーンのお知らせ')).toBeNull())
    await screen.findByText('流れの配信')
  })

  it('予約を取り消す窓は開いて閉じる・取り消すと下書きに戻る', async () => {
    mocks.query = 'id=b-2'
    await mount(<BroadcastDetailPage />)
    await screen.findByText('予約ずみ配信')

    const openMenu = async () => {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '配信「予約ずみ配信」の操作' }))
      })
      await screen.findByRole('menuitem', { name: '予約を取り消す' })
    }
    // 取り消しの窓を開いて、やめると閉じる（口を呼ばない）。
    await openMenu()
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '予約を取り消す' }))
    })
    await screen.findByText('「予約ずみ配信」の予約を取り消しますか？')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    })
    await waitFor(() => expect(screen.queryByText('「予約ずみ配信」の予約を取り消しますか？')).toBeNull())
    expect(mocks.cancelReservation).not.toHaveBeenCalled()

    // もう一度開いて取り消すと、窓が閉じて下書きに戻る。
    mocks.get.mockResolvedValueOnce({
      success: true,
      data: { ...draftRow('b-2', '予約ずみ配信') },
    })
    await openMenu()
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '予約を取り消す' }))
    })
    await screen.findByText('「予約ずみ配信」の予約を取り消しますか？')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '予約を取り消す' }))
    })
    await waitFor(() => expect(mocks.cancelReservation).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('「予約ずみ配信」の予約を取り消しますか？')).toBeNull())
    await screen.findByText('下書き')
    expect(screen.queryByText('予約済み')).toBeNull()
  })
})
