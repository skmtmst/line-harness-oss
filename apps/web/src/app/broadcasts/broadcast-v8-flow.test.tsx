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
import { fireEvent, screen, waitFor, within } from '@testing-library/react'

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
    displayStatus: 'scheduled', displayStatusLabel: '予約中',
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

vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'admin', canManageRole: (role: string | null | undefined) => role === 'owner' || role === 'admin' }))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: mocks.accountId, selectedAccount: null, loading: false }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { id: 'admin-1', role: 'admin', name: '管理者' } }) },
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

const heldCreate = vi.hoisted(() => ({ template: null as null | (() => void) }))
vi.mock('@/components/shared/action-menu', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/shared/action-menu')>()
  return { ...actual, default: (props: React.ComponentProps<typeof actual.default>) => {
    if (props.open && props.ariaLabel === '配信の作り方') heldCreate.template = props.items.find(item => item.id === 'create-template')?.onSelect ?? null
    return <actual.default {...props} />
  } }
})
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'
import BroadcastListV8 from '@/v8/broadcasts/list'
import { rememberStaffIdentity, forgetStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot } from '@/lib/session-snapshot'
import type { StaffMember } from '@line-crm/shared'
import BroadcastListPage from './page'
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
  heldCreate.template = null
  // mockした役割と、実行直前に読む本人APIの控えを同じ管理者にそろえる。
  forgetStaffIdentity(); forgetSessionSnapshot()
  rememberStaffIdentity({ id: 'admin-1', role: 'admin', name: '管理者', permissionKeys: [] } as unknown as StaffMember)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key === 'lh_staff_role' ? 'admin' : null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  })
  mocks.query = ''
  window.localStorage.setItem('lh_staff_role', 'admin')
  mocks.listRows = [draftRow('b-1', 'はじめの配信')]
  mocks.push.mockClear()
  mocks.create.mockClear()
  mocks.cancelReservation.mockClear()
  clearToastsForTest()
})

afterEach(() => {
  unmount()
  forgetStaffIdentity(); forgetSessionSnapshot()
  window.localStorage.removeItem('lh_staff_role')
  vi.unstubAllGlobals()
})

describe('V8 一斉配信の通し', () => {
  it('役割が管理者でも、開いたメニューの後に本人の控えを失うと作成を始めない', async () => {
    await mount(<BroadcastListPage />)
    await screen.findByText('はじめの配信')
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: '配信を作る' })[0]))
    const create = await screen.findByRole('menuitem', { name: /テンプレートから作る/ })
    const retained = heldCreate.template
    expect(retained).toBeTypeOf('function')
    await act(async () => { forgetStaffIdentity() })
    expect((create as HTMLButtonElement).disabled).toBe(true)
    await act(async () => fireEvent.click(create))
    expect(mocks.create).not.toHaveBeenCalled()
    await act(async () => retained!())
    await screen.findByText('権限が変わったため、配信の作成を中止しました。')
    expect(screen.queryByRole('dialog', { name: 'テンプレートを選ぶ' })).toBeNull()
    expect(mocks.create).not.toHaveBeenCalled()
    await act(async () => { rememberStaffIdentity({ id: 'admin-1', role: 'admin', name: '管理者', permissionKeys: [] } as unknown as StaffMember) })
    expect(screen.queryByRole('dialog', { name: 'テンプレートを選ぶ' })).toBeNull()
  })

  it('作る→下書き保存で入力を残す→一覧へ戻ると増えている', async () => {
    await mount(<BroadcastListPage />)
    await screen.findByText('はじめの配信')
    expect(screen.getByText('はじめの配信').closest('[data-template-region="content"]')?.closest('[data-page-template="list"]')).toBeTruthy()

    // 「配信を作る ▾」の「詳しく作る」は5つの手順（/broadcasts/new）へ移る。
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '配信を作る' })[0])
    })
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: /詳しく作る/ }))
    })
    expect(mocks.push).toHaveBeenCalledWith('/broadcasts/new')

    // 一覧の中の作る面は「テンプレートから作る」から開く。
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '配信を作る' })[0])
    })
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: /テンプレートから作る/ }))
    })
    // テンプレートの選択は使わず、メッセージの編集へ戻って自分で書く。
    await act(async () => {
      fireEvent.click(within(await screen.findByRole('dialog', { name: 'テンプレートを選ぶ' })).getByRole('button', { name: 'キャンセル' }))
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
    // 未選択のまま下書きを保存し、入力を残してから自分で一覧へ戻る。
    await screen.findByText('下書きを保存しました。')
    expect(screen.getByPlaceholderText('例：8月キャンペーンのお知らせ')).toHaveProperty('value', '流れの配信')
    expect(screen.getByPlaceholderText('テキストを入力')).toHaveProperty('value', 'こんにちは')
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      title: '流れの配信', messageContent: 'こんにちは', lineAccountId: 'acc-1',
      saveAsDraft: true, draftSendChoice: 'unselected', scheduledAt: null, stealthSpreadMinutes: 0,
    }), expect.objectContaining({ idempotencyKey: expect.any(String) }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'キャンセル', exact: true })) })
    await waitFor(() => expect(screen.queryByPlaceholderText('例：8月キャンペーンのお知らせ')).toBeNull())
    await screen.findByText('流れの配信')
  })

  it('予約を取り消す窓は開いて閉じる・取り消すと下書きに戻る', async () => {
    mocks.query = 'id=b-2'
    await mount(<BroadcastDetailPage />)
    await screen.findByText('予約ずみ配信')
    expect(screen.getByText('配信した設定').closest('[data-page-template="detail"]')).toBeTruthy()

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
      fireEvent.click(screen.getByRole('button', { name: '予約のまま残す' }))
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
    expect(screen.queryByText('予約中')).toBeNull()
  })
})
