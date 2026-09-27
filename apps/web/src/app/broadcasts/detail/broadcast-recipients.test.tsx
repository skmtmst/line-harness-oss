// @vitest-environment happy-dom
/*
 * #816 — 宛先のタブ（C-2）の描画。
 *
 * 空・読み込み中・失敗・正常の4つを固定する。
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({ recipients: vi.fn() }))

vi.mock('@/lib/api', () => ({ api: { broadcasts: { recipients: fixture.recipients } } }))

import BroadcastRecipients from './broadcast-recipients'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const SUMMARY = {
  sent: 1, failedTemporary: 1, failedPermanent: 1, unknown: 0, inFlight: 0,
  pending: 0, total: 3, retryableCount: 1,
}

function row(displayName: string, group: string, label: string) {
  return {
    friendId: `id-${displayName}`,
    displayName,
    lineAccountId: 'account-1',
    group,
    label,
    detail: '理由',
    retryable: group === 'failed_temporary',
    lineRequestId: null,
    errorCode: null,
    dispatchedAt: '2026-10-01T10:00:00+09:00',
    settledAt: '2026-10-01T10:00:00+09:00',
  }
}

describe('宛先のタブ', () => {
  it('読み込み中は1枚だけ出す', () => {
    fixture.recipients.mockImplementation(() => new Promise(() => undefined))
    render(<BroadcastRecipients broadcastId="b1" total={3} version={1} />)
    expect(screen.getByText('宛先を読み込んでいます')).toBeTruthy()
  })

  it('失敗は読み直せる', async () => {
    fixture.recipients.mockRejectedValueOnce(new Error('down'))
    fixture.recipients.mockResolvedValueOnce({
      success: true,
      data: { rows: [], summary: SUMMARY, aggregateOnly: false, aggregateReason: null, legacySuccessCount: null },
    })
    render(<BroadcastRecipients broadcastId="b1" total={3} version={1} />)
    await waitFor(() => expect(screen.getByText('宛先を表示できませんでした')).toBeTruthy())
    screen.getByRole('button', { name: 'もう一度読み込む' }).click()
    await waitFor(() => expect(screen.getByText('宛先の結果はまだありません')).toBeTruthy())
  })

  it('空は作り直しを促さない', async () => {
    fixture.recipients.mockResolvedValue({
      success: true,
      data: { rows: [], summary: SUMMARY, aggregateOnly: false, aggregateReason: null, legacySuccessCount: null },
    })
    render(<BroadcastRecipients broadcastId="b1" total={3} version={1} />)
    await waitFor(() => expect(screen.getByText('宛先の結果はまだありません')).toBeTruthy())
  })

  it('書き出しは宛先のタブの中に1つだけある', async () => {
    fixture.recipients.mockResolvedValue({
      success: true,
      data: {
        rows: [row('山田花子', 'delivered', '届いた')],
        summary: SUMMARY,
        aggregateOnly: false,
        aggregateReason: null,
        legacySuccessCount: null,
      },
    })
    render(<BroadcastRecipients broadcastId="b1" total={3} version={1} />)
    await waitFor(() => expect(screen.getByText('山田花子')).toBeTruthy())
    // 下の追従バーと二重にならない。タブの中の1つだけ。
    expect(screen.getAllByRole('button', { name: 'CSVに書き出す' })).toHaveLength(1)
  })

  it('宛先ごとに札と件数を出す', async () => {
    fixture.recipients.mockResolvedValue({
      success: true,
      data: {
        rows: [
          row('山田花子', 'delivered', '届いた'),
          row('佐々木健', 'failed_permanent', '失敗：届けられませんでした'),
          row('鈴木一郎', 'failed_temporary', '失敗：一時的（あとで再送できます）'),
        ],
        summary: SUMMARY,
        aggregateOnly: false,
        aggregateReason: null,
        legacySuccessCount: null,
      },
    })
    render(<BroadcastRecipients broadcastId="b1" total={3} version={1} />)
    await waitFor(() => expect(screen.getByText('山田花子')).toBeTruthy())
    expect(screen.getByText('届いた 1')).toBeTruthy()
    expect(screen.getByText('失敗 2')).toBeTruthy()
    expect(screen.getByText('送る前 0')).toBeTruthy()
    expect(screen.getByRole('button', { name: /1件を再送/ })).toBeTruthy()
  })

  it('旧配信は集約だけと書く（行を作らない）', async () => {
    fixture.recipients.mockResolvedValue({
      success: true,
      data: { rows: [], summary: SUMMARY, aggregateOnly: true, aggregateReason: 'legacy', legacySuccessCount: 120 },
    })
    render(<BroadcastRecipients broadcastId="b1" total={150} version={1} />)
    await waitFor(() => expect(screen.getByText('宛先ごとの結果はありません')).toBeTruthy())
  })
})
