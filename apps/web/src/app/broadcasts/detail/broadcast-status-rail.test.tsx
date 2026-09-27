// @vitest-environment happy-dom
/*
 * #816 — 状態の段（C-1）の描画。
 *
 * 10の状態の札と帯の文を固定する。わざと帯の文を変えると落ちる。
 */
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import BroadcastStatusRail from './broadcast-status-rail'
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
})
