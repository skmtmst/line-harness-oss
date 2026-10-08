// @vitest-environment happy-dom
/*
 * 監査 ROOT29/30/31：宛先のタブの続き・CSV・絞り込みの世代・再送の知らせ。
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

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

/*
 * 「続きを読み込む」の通信中に絞り込みを変えると、新しい一覧の読込が古い続きを捨てる。
 * そのとき「読み込み中」を戻さないと、新しい一覧の続きのボタンが押せないまま残る。
 * 古い続きの応答（成功・失敗とも）は新しい一覧へ入れない。
 */
describe('続きの通信中に絞り込みを変える（ROOT29〜31 の追加確認）', () => {
  type Pending = { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  const chooseFilter = async (label: string) => {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '宛先の絞り込み' })) })
    await act(async () => { fireEvent.click(within(screen.getByRole('option', { name: label })).getByRole('button')) })
  }
  const moreButton = () => screen.getByRole('button', { name: /^(続きを読み込む|読み込み中…)$/ }) as HTMLButtonElement

  for (const outcome of ['成功', '失敗'] as const) {
    it(`A の続きが遅れて${outcome}しても、B の一覧に入らず、B の続きを押せる`, async () => {
      let pendingA: Pending = { resolve: () => undefined, reject: () => undefined }
      fixture.recipients.mockImplementation((_id: string, query: { result: string; cursor?: string }) => {
        if (query.result === 'all' && !query.cursor) return Promise.resolve(page(['Aの一人目'], 'a2'))
        if (query.result === 'all' && query.cursor === 'a2') return new Promise((resolve, reject) => { pendingA = { resolve, reject } })
        if (query.result === 'delivered' && !query.cursor) return Promise.resolve(page(['Bの一人目'], 'b2'))
        if (query.result === 'delivered' && query.cursor === 'b2') return Promise.resolve(page(['Bの二人目'], null))
        return Promise.reject(new Error(`想定外: ${JSON.stringify(query)}`))
      })
      render(<BroadcastRecipients broadcastId="b1" total={3} version={1} />)
      await waitFor(() => expect(screen.getByText('Aの一人目')).toBeTruthy())
      await act(async () => { moreButton().click() })
      expect(moreButton().disabled).toBe(true)

      await chooseFilter('届いた')
      await waitFor(() => expect(screen.getByText('Bの一人目')).toBeTruthy())
      expect(moreButton().disabled).toBe(false)

      await act(async () => {
        if (outcome === '成功') pendingA.resolve(page(['Aの二人目'], 'a3'))
        else pendingA.reject(new Error('down'))
      })
      expect(screen.queryByText('Aの二人目')).toBeNull()
      expect(screen.queryByText(/続きを読み込めませんでした/)).toBeNull()
      expect(moreButton().disabled).toBe(false)

      await act(async () => { moreButton().click() })
      await waitFor(() => expect(screen.getByText('Bの二人目')).toBeTruthy())
      expect(fixture.recipients.mock.calls.at(-1)?.[1]).toMatchObject({ result: 'delivered', cursor: 'b2' })
      expect(screen.queryByRole('button', { name: '続きを読み込む' })).toBeNull()
    })
  }

  it('続きの通信中に再送して読み直しても、続きのボタンが押せる', async () => {
    let pendingMore: Pending = { resolve: () => undefined, reject: () => undefined }
    let firstPages = 0
    fixture.recipients.mockImplementation((_id: string, query: { cursor?: string }) => {
      if (!query.cursor) {
        firstPages += 1
        return Promise.resolve(page([firstPages === 1 ? '読み直し前の人' : '読み直し後の人'], 'c2'))
      }
      if (firstPages === 1) return new Promise((resolve, reject) => { pendingMore = { resolve, reject } })
      return Promise.resolve(page(['続きの人'], null))
    })
    fixture.retryFailed.mockResolvedValue({ success: true, retryTargets: 1 })
    render(<BroadcastRecipients broadcastId="b1" total={3} version={1} />)
    await waitFor(() => expect(screen.getByText('読み直し前の人')).toBeTruthy())
    await act(async () => { moreButton().click() })
    expect(moreButton().disabled).toBe(true)

    await act(async () => { screen.getByRole('button', { name: /件を再送/ }).click() })
    await waitFor(() => expect(screen.getByText('読み直し後の人')).toBeTruthy())
    expect(screen.getByText('1人に送り直しを始めました。')).toBeTruthy()
    expect(moreButton().disabled).toBe(false)

    await act(async () => { pendingMore.resolve(page(['古い続きの人'], null)) })
    expect(screen.queryByText('古い続きの人')).toBeNull()
    await act(async () => { moreButton().click() })
    await waitFor(() => expect(screen.getByText('続きの人')).toBeTruthy())
  })
})
