// @vitest-environment happy-dom
/*
 * ★V8 `Q28Gb`（詳細の下書きの頭出し）。
 * 下書きには「テストを送る」が出て、押すとテスト送信の口を呼ぶ。
 * 送った後・予約には出さない（送る相手が決まっているものは予約完了・詳細の流れを使う）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BroadcastDetailV8 from './detail-v8'
import { api, type ApiBroadcast } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual }
})
vi.mock('@/components/shared/toast', () => ({ notifyToast: vi.fn() }))
vi.mock('next/navigation', async importOriginal => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  useRouter: () => ({ push: () => {} }),
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))

const draft = {
  id: 'b1',
  title: '未購入者フォロー',
  status: 'draft',
  draftStep: 'message',
  messageContent: 'まだご購入いただいていない方へ',
  totalCount: 18,
  successCount: 0,
  scheduledAt: null,
  sentAt: null,
} as unknown as ApiBroadcast

const baseProps = {
  broadcast: draft,
  insight: null,
  insightState: 'ready' as const,
  audienceLabel: '条件なし',
  accountName: 'LINE公式アカウント',
  tab: 'overview' as const,
  onSelectTab: () => {},
  onExportCsv: () => {},
  onReload: () => {},
  canEdit: true,
  contentRef: { current: null } as React.RefObject<HTMLElement | null>,
  approval: {
    state: null,
    busy: false,
    message: null,
    requesterName: null,
    approverName: null,
    candidates: [],
    messageSummary: null,
    canReRequest: false,
    reApproverId: '',
    reApprovalNote: '',
    onApproverChange: () => {},
    onNoteChange: () => {},
    onRequest: () => {},
    onCancel: () => {},
    onRemind: () => {},
    onReject: () => {},
    onApprove: () => {},
  },
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.restoreAllMocks()
})

describe('詳細の下書きのテスト送信（Q28Gb）', () => {
  it('下書きには「テストを送る」が出て、押すと口を呼ぶ', async () => {
    const testSend = vi.spyOn(api.broadcasts, 'testSend').mockResolvedValue({ success: true, sent: 1, failed: 0 })
    act(() => {
      root.render(<BroadcastDetailV8 {...baseProps} />)
    })
    const button = Array.from(host.querySelectorAll('button')).find((el) => el.textContent === 'テストを送る')
    expect(button).toBeDefined()
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(testSend).toHaveBeenCalledWith('b1')
  })

  it('送った後には「テストを送る」が出ない', () => {
    act(() => {
      root.render(<BroadcastDetailV8 {...baseProps} broadcast={{ ...draft, status: 'sent' } as unknown as ApiBroadcast} />)
    })
    expect(
      Array.from(host.querySelectorAll('button')).find((el) => el.textContent === 'テストを送る'),
    ).toBeUndefined()
  })
})
