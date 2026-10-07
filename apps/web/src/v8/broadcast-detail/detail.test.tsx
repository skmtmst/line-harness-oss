// @vitest-environment happy-dom
/*
 * V8 一斉配信の詳細・予約したあと（src/v8/broadcast-detail）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * V8 のテーマで表示し、下書きの続き・閲覧のみ（押せないボタンを置かない）・競合の帯・
 * 承認する人の操作・予約の取り消しの窓（BeNtj）のボタンの並びを確かめる。
 */
import React, { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/broadcasts/detail',
  useSearchParams: () => new URLSearchParams(''),
}))

import BroadcastDetail, { type BroadcastDetailProps } from './detail'
import Reserved, { type ReservedProps } from './reserved'
import type { ApiBroadcast, BroadcastApprovalState } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function broadcast(overrides: Partial<ApiBroadcast> = {}): ApiBroadcast {
  return {
    id: 'broadcast-1',
    title: '未購入者フォロー',
    messageType: 'text',
    messageContent: 'まだご購入いただいていない方へ。',
    targetType: 'all',
    targetTagId: null,
    status: 'draft',
    scheduledAt: null,
    sentAt: null,
    totalCount: 18,
    successCount: 0,
    lineAccountId: 'account-a',
    accountIds: null,
    dedupPriority: null,
    failedAccountIds: null,
    trackLinks: false,
    draftStep: 'message',
    approvalStatus: 'none',
    displayStatus: 'draft',
    displayStatusLabel: '下書き',
    version: 1,
    createdAt: '2026-08-16T00:00:00.000Z',
    ...overrides,
  } as ApiBroadcast
}

function approvalProps(state: BroadcastApprovalState | null = null): BroadcastDetailProps['approval'] {
  return {
    state,
    busy: false,
    message: null,
    requesterName: '佐藤 美咲',
    approverName: '佐々木 亮太',
    candidates: [],
    messageSummary: null,
    canReRequest: false,
    reApproverId: '',
    reApprovalNote: '',
    onApproverChange: vi.fn(),
    onNoteChange: vi.fn(),
    onRequest: vi.fn(),
    onCancel: vi.fn(),
    onRemind: vi.fn(),
    onReject: vi.fn(),
    onApprove: vi.fn(),
  }
}

function detailProps(overrides: Partial<BroadcastDetailProps> = {}): BroadcastDetailProps {
  return {
    broadcast: broadcast(),
    insight: null,
    insightState: 'ready',
    audienceLabel: '条件なし',
    accountName: '然 - NEN -',
    tab: 'overview',
    onSelectTab: vi.fn(),
    recipients: <p>宛先の中身</p>,
    activity: <p>記録の中身</p>,
    onExportCsv: vi.fn(),
    onReload: vi.fn(),
    canEdit: true,
    contentRef: createRef<HTMLElement>(),
    approval: approvalProps(),
    ...overrides,
  }
}

function reservedProps(overrides: Partial<ReservedProps> = {}): ReservedProps {
  return {
    broadcast: broadcast({
      id: 'broadcast-0', title: '8月キャンペーンのお知らせ', status: 'scheduled', messageType: 'image',
      scheduledAt: '2026-08-24T01:00:00.000Z', displayStatus: 'scheduled', displayStatusLabel: '予約済み', draftStep: null,
    }),
    estimate: { audienceCount: 1213, hiddenExcluded: 12, warnings: [] },
    audienceLabel: 'このアカウントの友だち全員',
    approverName: null,
    accountName: '然 - NEN -',
    notificationText: '',
    canEdit: true,
    testSend: vi.fn(),
    duplicate: vi.fn(),
    actionBusy: null,
    actionError: '',
    clearActionError: vi.fn(),
    cancelOpen: false,
    openCancel: vi.fn(),
    closeCancel: vi.fn(),
    confirmCancel: vi.fn(),
    cancelling: false,
    cancelError: '',
    cancelled: false,
    ...overrides,
  }
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  push.mockReset()
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
})

async function render(node: React.ReactNode) {
  await act(async () => { root.render(node) })
  await act(async () => {})
}

const buttons = () => [...document.querySelectorAll('button')] as HTMLButtonElement[]
const buttonText = (text: string) => buttons().find((button) => button.textContent?.trim() === text)
const linkText = (text: string) => [...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === text) as HTMLAnchorElement | undefined

describe('V8 一斉配信の詳細', () => {
  it('下書きは止まった手順（3 メッセージ）から続けるボタンと、テスト送信・CSV・「…」を置く', async () => {
    await render(<BroadcastDetail {...detailProps()} />)
    const resume = linkText('3 メッセージから続ける')
    expect(resume?.getAttribute('href')).toBe('/broadcasts/new?draft=broadcast-1&step=message')
    expect(buttonText('テストを送る')).toBeTruthy()
    expect(buttonText('CSVで書き出す')).toBeTruthy()
    expect(document.querySelector('[aria-label="配信「未購入者フォロー」の操作"]')).toBeTruthy()
    // 済んだ手順は押すとその手順へ戻る。
    expect(linkText('2 対象者')?.getAttribute('href')).toBe('/broadcasts/new?draft=broadcast-1&step=audience')
    expect(host.textContent).toContain('「3 メッセージから続ける」で作るのを続けられます。')
  })

  it('閲覧のみには変える操作を置かない（押せないボタンも残さない）。CSV は出す', async () => {
    await render(<BroadcastDetail {...detailProps({ canEdit: false })} />)
    expect(linkText('3 メッセージから続ける')).toBeUndefined()
    expect(buttonText('テストを送る')).toBeUndefined()
    expect(document.querySelector('[aria-label="配信「未購入者フォロー」の操作"]')).toBeNull()
    expect(linkText('2 対象者')).toBeUndefined()
    expect(buttonText('CSVで書き出す')).toBeTruthy()
    expect(host.textContent).not.toContain('から続ける')
    expect(buttons().filter((button) => button.disabled).map((button) => button.textContent)).toEqual([])
  })

  it('ほかの人が更新したら帯を出し、「読み直す」で読み直しを頼む（Q28Gb）', async () => {
    const onConflictReload = vi.fn()
    await render(<BroadcastDetail {...detailProps({ conflict: true, onConflictReload })} />)
    const alert = document.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('ほかの人が配信「未購入者フォロー」を更新しました')
    expect(alert?.textContent).toContain('この画面では書き換えません')
    await act(async () => { buttonText('読み直す')!.click() })
    expect(onConflictReload).toHaveBeenCalledTimes(1)
  })

  it('承認を頼まれた人は、理由を入れるまで差し戻せない。承認して送るは押せる（pNiUk）', async () => {
    const state: BroadcastApprovalState = {
      approval: {
        status: 'pending', requestedByStaffId: 'staff-a', requestedAt: '2026-09-25T11:10:00.000Z', approverStaffId: 'staff-b',
        note: '秋の案内です', decidedByStaffId: null, decidedAt: null, rejectReason: null, confirmedCount: null,
      },
      gate: { required: true, recipientCount: 1248, threshold: 1000, singleOperator: false, operatorCount: 2 },
      viewer: { isApprover: true, canApprove: true, isRequester: false },
    }
    const approval = approvalProps(state)
    await render(<BroadcastDetail {...detailProps({
      broadcast: broadcast({ id: 'broadcast-0', status: 'scheduled', scheduledAt: '2026-08-24T01:00:00.000Z', approvalStatus: 'pending', displayStatus: 'pending_approval', displayStatusLabel: '承認待ち' }),
      approval,
    })} />)
    expect(host.textContent).toContain('あなたの承認を待っています')
    expect(host.textContent).toContain('を過ぎると、送らずに期限切れになります。')
    const reject = buttonText('差し戻す')!
    expect(reject.disabled).toBe(true)
    const input = document.getElementById('approval-reject-reason') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '日時を10月に')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(buttonText('差し戻す')!.disabled).toBe(false)
    await act(async () => { buttonText('差し戻す')!.click() })
    expect(approval.onReject).toHaveBeenCalledWith('日時を10月に')
    await act(async () => { buttonText('承認して送る')!.click() })
    expect(approval.onApprove).toHaveBeenCalledTimes(1)
  })

  it('送った配信は 複製して作る と CSV。テスト送信は出さない（F3X1Mo）', async () => {
    await render(<BroadcastDetail {...detailProps({
      broadcast: broadcast({ id: 'broadcast-2', status: 'sent', sentAt: '2026-08-20T03:00:00.000Z', successCount: 624, totalCount: 626, displayStatus: 'sent', displayStatusLabel: '送信済み', draftStep: null }),
    })} />)
    expect(linkText('複製して作る')?.getAttribute('href')).toBe('/broadcasts/new?duplicateFrom=broadcast-2')
    expect(buttonText('テストを送る')).toBeUndefined()
    expect(host.textContent).toContain('配信結果')
    expect(host.textContent).toContain('送信に失敗した人がいます（2 人）。')
  })
})

describe('V8 一斉配信を予約したあと', () => {
  it('「予約を取り消す…」で確かめの窓を開く。窓のボタンは 取り消す・やめる・予約のまま残す の順（BeNtj）', async () => {
    const props = reservedProps()
    await render(<Reserved {...props} />)
    await act(async () => { buttonText('予約を取り消す…')!.click() })
    expect(props.openCancel).toHaveBeenCalledTimes(1)
    await render(<Reserved {...props} cancelOpen />)
    const dialog = document.querySelector('[role="alertdialog"], [role="dialog"]')!
    expect(dialog.textContent).toContain('「8月キャンペーンのお知らせ」の予約を取り消しますか？')
    expect(dialog.textContent).toContain('1,213人 に送らなくなります。取り消すと下書きに戻り、もう一度予約できます。')
    const order = [...dialog.querySelectorAll('button')].map((button) => button.textContent?.trim()).filter((text) => text && text !== '')
    expect(order.slice(-3)).toEqual(['予約を取り消す', 'やめる', '予約のまま残す'])
    await act(async () => { buttonText('予約を取り消す')!.click() })
    expect(props.confirmCancel).toHaveBeenCalledTimes(1)
  })

  it('閲覧のみには 次にできること の操作を置かない（押せないボタンも残さない）', async () => {
    await render(<Reserved {...reservedProps({ canEdit: false })} />)
    expect(buttonText('テストを送る')).toBeUndefined()
    expect(buttonText('複製して別の配信を作る')).toBeUndefined()
    expect(buttonText('予約を取り消す…')).toBeUndefined()
    expect(host.textContent).not.toContain('次にできること')
    expect(buttons().filter((button) => button.disabled)).toEqual([])
    expect(linkText('予約の内容を見る')?.getAttribute('href')).toBe('/broadcasts/detail?id=broadcast-0')
  })
})
