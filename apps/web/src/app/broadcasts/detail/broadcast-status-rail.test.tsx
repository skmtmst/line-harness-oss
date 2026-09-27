// @vitest-environment happy-dom
/*
 * #816 — 状態の段（C-1）の描画。
 *
 * 10の状態の札と帯の文を固定する。わざと帯の文を変えると落ちる。
 */
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import BroadcastStatusRail, { isApprovalInvolved } from './broadcast-status-rail'
import type { BroadcastDisplayStatus } from '@/lib/api'

afterEach(() => cleanup())

const formatDateTime = (value: string | null | undefined) => value ?? '—'

const LABELS: Array<[BroadcastDisplayStatus, string]> = [
  ['draft', '下書き'],
  ['pending_approval', '承認待ち'],
  ['scheduled', '予約済み'],
  ['preparing', '送信準備'],
  ['sending', '送信中'],
  ['sent', '送信済み'],
  ['partial_failed', '一部失敗'],
  ['failed', '失敗'],
  ['stopped', '停止'],
  ['expired', '期限切れ'],
]

describe('状態の段', () => {
  it.each(LABELS)('%s は「%s」と出す', (displayStatus, label) => {
    const { unmount } = render(
      <BroadcastStatusRail
        displayStatus={displayStatus}
        approvalInvolved
        scheduled
        ledger={null}
        total={0}
        formatDateTime={formatDateTime}
        scheduledAt={null}
      />,
    )
    expect(screen.getByLabelText('配信の状態').textContent).toContain(label)
    unmount()
  })

  it('送信中は人数と止めたときの範囲を帯に出す', () => {
    render(
      <BroadcastStatusRail
        displayStatus="sending"
        approvalInvolved={false}
        scheduled={false}
        ledger={{ sent: 812, failed: 0, unknown: 0, inFlight: 400, retryableCount: 0 }}
        total={1248}
        formatDateTime={formatDateTime}
        scheduledAt={null}
      />,
    )
    expect(screen.getByLabelText('配信の状態').textContent).toContain('812 / 1,248人')
  })

  it('承認がいらない配信に承認待ちの段は出さない', () => {
    render(
      <BroadcastStatusRail
        displayStatus="sent"
        approvalInvolved={false}
        scheduled={false}
        ledger={null}
        total={10}
        formatDateTime={formatDateTime}
        scheduledAt={null}
      />,
    )
    expect(screen.getByLabelText('配信の状態').textContent).not.toContain('承認待ち')
  })

  it('承認を通った配信は送り終わっても承認待ちの段を出す', () => {
    render(
      <BroadcastStatusRail
        displayStatus="sent"
        approvalInvolved
        scheduled
        ledger={null}
        total={10}
        formatDateTime={formatDateTime}
        scheduledAt={null}
      />,
    )
    expect(screen.getByLabelText('配信の状態').textContent).toContain('承認待ち')
  })

  it('送り終わったら最後の段も✓にし、「いまいる所」の輪は出さない', () => {
    const { container } = render(
      <BroadcastStatusRail
        displayStatus="sent"
        approvalInvolved
        scheduled
        ledger={null}
        total={10}
        formatDateTime={formatDateTime}
        scheduledAt={null}
      />,
    )
    // 6段すべて済み（✓）。輪（aria-current）はどこにも無い。
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0)
    expect(container.querySelectorAll('svg')).toHaveLength(6)
  })

  it('途中だけ「いまいる所」の輪を1つ出す', () => {
    const { container } = render(
      <BroadcastStatusRail
        displayStatus="sending"
        approvalInvolved
        scheduled
        ledger={null}
        total={10}
        formatDateTime={formatDateTime}
        scheduledAt={null}
      />,
    )
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1)
    expect(screen.getByLabelText('配信の状態').textContent).toContain('送信中')
  })

  it('止めた配信は輪を出さず、着いた段までを✓にする', () => {
    const { container } = render(
      <BroadcastStatusRail
        displayStatus="stopped"
        approvalInvolved={false}
        scheduled={false}
        ledger={null}
        total={10}
        formatDateTime={formatDateTime}
        scheduledAt={null}
      />,
    )
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0)
    expect(screen.getByLabelText('配信の状態').textContent).toContain('停止')
  })
})

describe('承認が絡むかの判定', () => {
  const approvedState = {
    approval: {
      status: 'approved',
      requestedByStaffId: 'staff-sender',
      requestedAt: '2026-09-25T20:10:00+09:00',
      approverStaffId: 'staff-approver',
      note: null,
      decidedByStaffId: 'staff-approver',
      decidedAt: '2026-09-25T21:02:00+09:00',
      rejectReason: null,
      confirmedCount: null,
    },
    gate: { required: true, recipientCount: 1248, threshold: 1000, singleOperator: false, operatorCount: 2 },
    viewer: { isApprover: false, canApprove: false, isRequester: true },
  } as const

  it('承認を通った配信は絡む', () => {
    expect(isApprovalInvolved('approved', null)).toBe(true)
  })

  it('配信本体が古くても承認の記録があれば絡む', () => {
    expect(isApprovalInvolved(undefined, { ...approvedState, approval: { ...approvedState.approval } })).toBe(true)
  })

  it('承認の要らない配信は絡まない', () => {
    expect(isApprovalInvolved('none', null)).toBe(false)
    expect(isApprovalInvolved(undefined, null)).toBe(false)
  })
})
