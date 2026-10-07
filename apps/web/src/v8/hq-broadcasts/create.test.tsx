// @vitest-environment happy-dom
/*
 * 統括 一括配信を作る（提案 E-9 p17Qku）・詳細（xOXuY）の動きの試験。
 * タグで選ぶ → 本文 → 確かめる（作る → preflight → 問題のある店を外す）→ 送る（確かめの窓 → send）。
 * 詳細は失敗した店へのやり直し。閲覧のみ（担当者）には作る画面を出さない。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hq = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), get: vi.fn(), preflight: vi.fn(), exclude: vi.fn(), send: vi.fn(), stop: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
}))
const accounts = vi.hoisted(() => vi.fn())
const tags = vi.hoisted(() => vi.fn())
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const push = vi.hoisted(() => vi.fn())
const params = vi.hoisted(() => ({ value: new URLSearchParams() }))

vi.mock('@/lib/hq-broadcasts-api', () => ({ hqBroadcastsApi: hq }))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, api: { ...actual.api, lineAccounts: { list: accounts }, lineAccountTags: { list: tags } } }
})
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => role.value, canManageRole: (r: string | null) => r === 'owner' || r === 'admin' }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => params.value }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))

import HqBroadcastCreate from './create'
import HqBroadcastDetail from './detail'

const check = (accountId: string, accountName: string, audienceCount: number, blockedReasons: string[] = []) => ({
  accountId, accountName, audienceCount, remaining: 10000, connected: true, paused: false, blockedReasons, excluded: false, broadcastId: null,
})

beforeEach(() => {
  role.value = 'owner'
  params.value = new URLSearchParams()
  accounts.mockResolvedValue({ success: true, data: [
    { id: 'a1', name: '銀座店', tags: [{ id: 't1', name: '関東', color: null }], stats: { friendCount: 6120 } },
    { id: 'a2', name: '新宿店', tags: [{ id: 't1', name: '関東', color: null }], stats: { friendCount: 5880 } },
    { id: 'a3', name: '梅田店', tags: [{ id: 't2', name: '関西', color: null }], stats: { friendCount: 3950 } },
  ] })
  tags.mockResolvedValue({ success: true, data: [{ id: 't1', name: '関東', color: null }, { id: 't2', name: '関西', color: null }] })
  hq.create.mockResolvedValue({ data: { id: 'run-1', title: 't', status: 'prepared', version: 1, scheduledAt: null, targets: [] } })
  hq.preflight.mockResolvedValue({ data: [check('a1', '銀座店', 6120), check('a2', '新宿店', 5880, ['今月の送信枠が足りません'])] })
  hq.exclude.mockResolvedValue({ data: { id: 'run-1', title: 't', status: 'prepared', version: 2, scheduledAt: null, targets: [] } })
  hq.send.mockResolvedValue({ data: {} })
  hq.cancel.mockResolvedValue({ data: {} })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('一括配信を作る（p17Qku）', () => {
  it('タグで選び、確かめると問題のある店を外し、送ると版を付けて送る', async () => {
    render(<HqBroadcastCreate />)
    fireEvent.click(await screen.findByRole('button', { name: '関東（2店）' }))
    expect(screen.getByText('12,000')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: '{店名}より：1月の限定メニュー' } })
    fireEvent.click(screen.getByRole('button', { name: '送る前に確かめる' }))
    await screen.findByText('送る：1店・6,120人')
    const input = hq.create.mock.calls[0][0]
    expect(input.accountTagIds).toEqual(['t1'])
    expect(input.messageContent).toBe('{{account.name}}より：1月の限定メニュー')
    expect(input.requestId).toBeTruthy()
    /* 送信枠の足りない新宿店は外す（口は外した店を送らない）。版は作ったときの 1。 */
    expect(hq.exclude).toHaveBeenCalledWith('run-1', ['a2'], 1)
    expect(screen.getByText('送る：1店・6,120人')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /1店に送る/ }))
    fireEvent.click(await screen.findByRole('button', { name: '予約する' }))
    await waitFor(() => expect(hq.send).toHaveBeenCalledWith('run-1', 2))
    expect(push).toHaveBeenCalledWith('/hq/broadcasts/detail?id=run-1')
  })

  it('本文を変えたら、もう一度確かめるまで送らない（前の下書きは取り消して作り直す）', async () => {
    render(<HqBroadcastCreate />)
    fireEvent.click(await screen.findByRole('button', { name: '関東（2店）' }))
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: 'はじめの本文' } })
    fireEvent.click(screen.getByRole('button', { name: '送る前に確かめる' }))
    await screen.findByText('送る：1店・6,120人')
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: '直した本文' } })
    expect(screen.getByRole('button', { name: '送る前に確かめる' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '送る前に確かめる' }))
    await waitFor(() => expect(hq.create).toHaveBeenCalledTimes(2))
    expect(hq.cancel).toHaveBeenCalledWith('run-1', 2)
    expect(hq.create.mock.calls[1][0].messageContent).toBe('直した本文')
  })

  it('閲覧のみ（担当者）には作る画面を出さない', async () => {
    role.value = 'staff'
    render(<HqBroadcastCreate />)
    expect(screen.getByText(/統括全体の編集権限がある人/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /店に送る/ })).toBeNull()
  })
})

describe('一括配信の詳細（xOXuY ⑤ 送った結果）', () => {
  it('店ごとの結果を出し、失敗した店にやり直す（店の配信の版を付ける）', async () => {
    params.value = new URLSearchParams('id=run-9')
    hq.get.mockResolvedValue({ data: {
      id: 'run-9', title: '1月の限定メニュー', status: 'scheduled', version: 4, scheduledAt: '2026-01-15T02:00:00.000Z',
      targets: [
        { ...check('a1', '銀座店', 6120), status: 'sent', totalCount: 6120, successCount: 6118, version: 3, retryableCount: 0, stopped: false, broadcastId: 'b1' },
        { ...check('a3', '名古屋店', 460), status: 'failed', totalCount: 460, successCount: 0, version: 5, retryableCount: 460, stopped: false, broadcastId: 'b3' },
      ],
    } })
    hq.retry.mockResolvedValue({ data: {} })
    render(<HqBroadcastDetail />)
    await screen.findByText('⑤ 送った結果')
    expect(screen.getByText('送れた')).toBeTruthy()
    expect(screen.getAllByText('失敗')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /失敗した店にやり直す/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'やり直す' }))
    await waitFor(() => expect(hq.retry).toHaveBeenCalledWith('run-9', 'a3', 5))
    expect(hq.retry).toHaveBeenCalledTimes(1)
  })
})
