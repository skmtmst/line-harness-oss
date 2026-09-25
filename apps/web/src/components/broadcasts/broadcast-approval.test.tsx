// @vitest-environment happy-dom
/*
 * 二者承認の見た目の試験（m12a / 設計 A）。
 *
 * 主な状態を確かめる。空（出すものなし）・読み込み中・失敗・正常。
 * 承認する人にだけ操作を出すことと、自分の依頼には出さないことも見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import {
  ApprovalBadge,
  ApprovalRequestFields,
  ApprovalStatusSection,
  ApproverSection,
  SingleOperatorFields,
} from './broadcast-approval'
import type { BroadcastApprovalState } from '@/lib/api'

function render(node: React.ReactElement): { root: Root; host: HTMLElement } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(node)
  })
  return { root, host }
}

function cleanup(rendered: { root: Root; host: HTMLElement }) {
  act(() => {
    rendered.root.unmount()
  })
  rendered.host.remove()
}

function pendingState(overrides: Partial<BroadcastApprovalState['viewer']> = {}): BroadcastApprovalState {
  return {
    approval: {
      status: 'pending',
      requestedByStaffId: 'staff-send',
      requestedAt: '2026-09-25T10:00:00+09:00',
      approverStaffId: 'staff-approve',
      note: '秋の案内です',
      decidedByStaffId: null,
      decidedAt: null,
      rejectReason: null,
      confirmedCount: null,
    },
    gate: {
      required: true,
      recipientCount: 1248,
      threshold: 1000,
      singleOperator: false,
      operatorCount: 2,
    },
    viewer: {
      isApprover: false,
      canApprove: false,
      isRequester: true,
      ...overrides,
    },
  }
}

describe('二者承認の見た目', () => {
  it('一覧の札は承認待ち・期限切れだけ出す（空は出さない）', () => {
    const pending = render(<ApprovalBadge status="pending" />)
    expect(pending.host.textContent).toContain('承認待ち')
    cleanup(pending)

    const expired = render(<ApprovalBadge status="expired" />)
    expect(expired.host.textContent).toContain('期限切れ')
    cleanup(expired)

    for (const status of ['none', 'approved', 'rejected', 'cancelled', undefined] as const) {
      const empty = render(<ApprovalBadge status={status} />)
      expect(empty.host.textContent).toBe('')
      cleanup(empty)
    }
  })

  it('A-1 承認する人の選択・ひとこと・人数が出る', () => {
    const rendered = render(
      <ApprovalRequestFields
        recipientCount={1248}
        threshold={1000}
        candidates={[{ id: 'a1', name: '佐藤 美咲', role: 'admin', canApprove: true }]}
        candidatesState="ready"
        approverId=""
        onApproverChange={() => undefined}
        note=""
        onNoteChange={() => undefined}
      />,
    )
    expect(rendered.host.textContent).toContain('承認をお願いする人')
    expect(rendered.host.textContent).toContain('佐藤 美咲')
    expect(rendered.host.textContent).toContain('1,248人')
    cleanup(rendered)
  })

  it('A-1 候補の読み込み中・失敗を分けて出す', () => {
    const loading = render(
      <ApprovalRequestFields
        recipientCount={1248}
        threshold={1000}
        candidates={[]}
        candidatesState="loading"
        approverId=""
        onApproverChange={() => undefined}
        note=""
        onNoteChange={() => undefined}
      />,
    )
    expect(loading.host.textContent).toContain('読み込んでいます')
    cleanup(loading)

    const failed = render(
      <ApprovalRequestFields
        recipientCount={1248}
        threshold={1000}
        candidates={[]}
        candidatesState="error"
        approverId=""
        onApproverChange={() => undefined}
        note=""
        onNoteChange={() => undefined}
      />,
    )
    expect(failed.host.textContent).toContain('読み込めませんでした')
    cleanup(failed)
  })

  it('A-2 承認待ちの帯に取り消し・もう一度知らせるが出る', () => {
    const rendered = render(
      <ApprovalStatusSection
        approval={pendingState().approval}
        scheduledLabel="10月1日 10:00"
        onCancel={() => undefined}
        onRemind={() => undefined}
        busy={false}
        message={null}
      />,
    )
    expect(rendered.host.textContent).toContain('承認を待っています')
    expect(rendered.host.textContent).toContain('依頼を取り消す')
    expect(rendered.host.textContent).toContain('もう一度知らせる')
    cleanup(rendered)
  })

  it('A-2 差し戻し・期限切れの理由が出る', () => {
    const rejected: BroadcastApprovalState = {
      ...pendingState(),
      approval: { ...pendingState().approval, status: 'rejected', rejectReason: '金額が古い' },
    }
    const rejectedView = render(
      <ApprovalStatusSection
        approval={rejected.approval}
        scheduledLabel={null}
        onCancel={() => undefined}
        onRemind={() => undefined}
        busy={false}
        message={null}
      />,
    )
    expect(rejectedView.host.textContent).toContain('金額が古い')
    cleanup(rejectedView)

    const expired: BroadcastApprovalState = {
      ...pendingState(),
      approval: { ...pendingState().approval, status: 'expired' },
    }
    const expiredView = render(
      <ApprovalStatusSection
        approval={expired.approval}
        scheduledLabel={null}
        onCancel={() => undefined}
        onRemind={() => undefined}
        busy={false}
        message={null}
      />,
    )
    expect(expiredView.host.textContent).toContain('期限切れ')
    cleanup(expiredView)
  })

  it('A-3 承認する人にだけ操作が出る（頼んだ人には出さない）', () => {
    const approverState = pendingState({ isApprover: true, canApprove: true, isRequester: false })
    const approver = render(
      <ApproverSection
        approval={approverState.approval}
        viewer={approverState.viewer}
        requesterName="川野 健太"
        messageHref="#broadcast-content"
        onApprove={() => undefined}
        onReject={() => undefined}
        busy={false}
        message={null}
      />,
    )
    expect(approver.host.textContent).toContain('あなたの確認待ち')
    expect(approver.host.textContent).toContain('承認して送る')
    expect(approver.host.textContent).toContain('差し戻す')
    cleanup(approver)

    // 頼んだ人には操作を出さない。
    const requesterState = pendingState()
    const requester = render(
      <ApproverSection
        approval={requesterState.approval}
        viewer={requesterState.viewer}
        requesterName="川野 健太"
        messageHref="#broadcast-content"
        onApprove={() => undefined}
        onReject={() => undefined}
        busy={false}
        message={null}
      />,
    )
    expect(requester.host.textContent).toBe('')
    cleanup(requester)
  })

  it('補足は「？」に入り、本文に重ねて書かない', () => {
    const fields = render(
      <ApprovalRequestFields
        recipientCount={1248}
        threshold={1000}
        candidates={[]}
        candidatesState="ready"
        approverId=""
        onApproverChange={() => undefined}
        note=""
        onNoteChange={() => undefined}
      />,
    )
    expect(fields.host.querySelector('button[aria-label="承認をお願いする人の説明"]')).not.toBeNull()
    expect(fields.host.textContent).not.toContain('自分は選べない')
    cleanup(fields)

    const count = render(
      <SingleOperatorFields recipientCount={1248} value="" onChange={() => undefined} />,
    )
    expect(count.host.querySelector('button[aria-label="人数の説明"]')).not.toBeNull()
    cleanup(count)

    const approverState = pendingState({ isApprover: true, canApprove: true, isRequester: false })
    const approver = render(
      <ApproverSection
        approval={approverState.approval}
        viewer={approverState.viewer}
        requesterName={null}
        messageHref="#broadcast-content"
        onApprove={() => undefined}
        onReject={() => undefined}
        busy={false}
        message={null}
      />,
    )
    expect(approver.host.querySelector('button[aria-label="承認の依頼の説明"]')).not.toBeNull()
    expect(approver.host.textContent).not.toContain('自分が頼んだ配信は承認できない')
    cleanup(approver)
  })

  it('A-4 人数の一致・不一致が分かる', () => {
    const matched = render(
      <SingleOperatorFields recipientCount={1248} value="1248" onChange={() => undefined} />,
    )
    expect(matched.host.textContent).toContain('人数が合いました')
    cleanup(matched)

    const mismatched = render(
      <SingleOperatorFields recipientCount={1248} value="1247" onChange={() => undefined} />,
    )
    expect(mismatched.host.textContent).toContain('人数が合いません')
    cleanup(mismatched)
  })
})
