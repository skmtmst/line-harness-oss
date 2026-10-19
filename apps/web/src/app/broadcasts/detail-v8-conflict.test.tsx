// @vitest-environment happy-dom
/*
 * ★V8 （詳細の競合の帯）の描画。
 * 競合のときだけ帯と「読み直す」が出て、ふだんは出ない。
 * 現役V8の部品で、読み直しの操作を確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BroadcastDetailV8 from '@/v8/broadcast-detail/detail'
import type { ApiBroadcast } from '@/lib/api'
import type { StaffMember } from '@line-crm/shared'
import { rememberStaffIdentity, forgetStaffIdentity } from '@/lib/staff-identity-state'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual }
})
vi.mock('next/navigation', async () => ({
  ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push: () => {} }),
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))

const broadcast = {
  id: 'b1',
  title: '未購入者フォロー',
  status: 'draft',
  draftStep: null,
  messageContent: 'まだご購入いただいていない方へ',
  totalCount: 18,
  successCount: 0,
  scheduledAt: null,
  sentAt: null,
} as unknown as ApiBroadcast

const baseProps = {
  broadcast,
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
  rememberStaffIdentity({ role: 'owner', permissionKeys: [] } as unknown as StaffMember)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  forgetStaffIdentity()
})

describe('詳細の競合の帯（Q28Gb）', () => {
  it('競合のときだけ帯・板ID・読み直すが出る', async () => {
    let clicked = 0
    act(() => {
      root.render(<BroadcastDetailV8 {...baseProps} conflict onConflictReload={() => { clicked += 1 }} />)
    })
    const bar = host.querySelector('[data-design-node="Q28Gb"]')
    expect(bar).not.toBeNull()
    expect(bar?.textContent).toContain('ほかの人が配信「未購入者フォロー」を更新しました')
    const button = Array.from(host.querySelectorAll('button')).find((el) => el.textContent === '最新を読み込んで続ける')
    expect(button).toBeDefined()
    await act(async () => { button?.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
    expect(clicked).toBe(1)
  })

  it('ふだんは帯が出ない', () => {
    act(() => {
      root.render(<BroadcastDetailV8 {...baseProps} conflict={false} />)
    })
    expect(host.querySelector('[data-design-node="Q28Gb"]')).toBeNull()
  })
})
