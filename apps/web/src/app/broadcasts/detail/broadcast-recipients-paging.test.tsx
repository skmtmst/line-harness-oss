// @vitest-environment happy-dom
/*
 * 監査 ROOT29/30/31：宛先のタブの続き・CSV・絞り込みの世代・再送の知らせ。
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({ recipients: vi.fn(), retryFailed: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { broadcasts: { recipients: fixture.recipients, retryFailed: fixture.retryFailed } } }))

import BroadcastRecipients, { RECIPIENT_CSV_MAX_PAGES } from './broadcast-recipients'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

const SUMMARY = {
  sent: 2, failedTemporary: 1, failedPermanent: 0, unknown: 0, inFlight: 0,
  pending: 0, total: 3, retryableCount: 1,
}
const row = (name: string) => ({
  friendId: `id-${name}`, displayName: name, lineAccountId: 'a', group: 'delivered', label: '届いた',
  detail: '', retryable: false, lineRequestId: null, errorCode: null, dispatchedAt: null, settledAt: null,
})
const page = (names: string[], nextCursor: string | null) => ({
  success: true,
  data: { rows: names.map(row), summary: SUMMARY, aggregateOnly: false, aggregateReason: null, legacySuccessCount: null },
  pagination: { nextCursor },
})

describe('宛先のタブの続き（ROOT29）', () => {
  it('最初の50件のあとに続きがあれば「続きを読み込む」で足す', async () => {
    fixture.recipients
      .mockResolvedValueOnce(page(['一人目'], 'c2'))
      .mockResolvedValueOnce(page(['二人目'], null))
    render(<BroadcastRecipients broadcastId="b1" total={2} version={1} />)
    await waitFor(() => expect(screen.getByText('一人目')).toBeTruthy())
    await act(async () => { screen.getByRole('button', { name: '続きを読み込む' }).click() })
    await waitFor(() => expect(screen.getByText('二人目')).toBeTruthy())
    expect(fixture.recipients.mock.calls[1][1]).toMatchObject({ cursor: 'c2' })
    expect(screen.queryByRole('button', { name: '続きを読み込む' })).toBeNull()
  })

  it('CSV は続きが残ったまま打ち切ったら書き出さずに知らせる', async () => {
    const created = vi.fn(() => 'blob:x')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: () => undefined }))
    fixture.recipients.mockResolvedValue(page(['一人目'], 'more'))
    render(<BroadcastRecipients broadcastId="b1" total={2} version={1} />)
    await waitFor(() => expect(screen.getByText('一人目')).toBeTruthy())
    await act(async () => { screen.getByRole('button', { name: 'CSVに書き出す' }).click() })
    await waitFor(() => expect(screen.getByText(/CSVに書き出せませんでした/)).toBeTruthy())
    expect(created).not.toHaveBeenCalled()
    expect(fixture.recipients.mock.calls.length).toBe(1 + RECIPIENT_CSV_MAX_PAGES)
  })
})

describe('絞り込みの世代と再送の知らせ（ROOT30/31）', () => {
  it('再送の成功の知らせは、読み直しのあとも残る', async () => {
    fixture.recipients.mockResolvedValue(page(['一人目'], null))
    fixture.retryFailed.mockResolvedValue({ success: true, retryTargets: 1 })
    render(<BroadcastRecipients broadcastId="b1" total={2} version={1} />)
    await waitFor(() => expect(screen.getByText('一人目')).toBeTruthy())
    await act(async () => { screen.getByRole('button', { name: /件を再送/ }).click() })
    await waitFor(() => expect(screen.getByText('1人に送り直しを始めました。')).toBeTruthy())
  })

  it('前の配信の遅い応答で、今の配信の宛先を上書きしない', async () => {
    let resolveOld: (value: unknown) => void = () => undefined
    fixture.recipients
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce(page(['今の配信の人'], null))
    const view = render(<BroadcastRecipients broadcastId="b1" total={2} version={1} />)
    view.rerender(<BroadcastRecipients broadcastId="b2" total={2} version={1} />)
    await waitFor(() => expect(screen.getByText('今の配信の人')).toBeTruthy())
    await act(async () => { resolveOld(page(['前の配信の人'], null)) })
    expect(screen.queryByText('前の配信の人')).toBeNull()
    expect(screen.getByText('今の配信の人')).toBeTruthy()
  })
})
