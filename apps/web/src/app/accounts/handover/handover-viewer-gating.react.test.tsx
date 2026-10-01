// @vitest-environment happy-dom
/*
 * R522: 見るだけの担当者（staff）には引き継ぎの変更入口を出さない。
 * owner には出す。役割×操作の表を実マウントで固定する。
 * 口側の発行・連結の staff 拒否は Worker の試験で見る。ここでは画面側だけ。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const staffMe = vi.hoisted(() => vi.fn())
const accountsGet = vi.hoisted(() => vi.fn())
const accountsList = vi.hoisted(() => vi.fn())
const handoversForAccount = vi.hoisted(() => vi.fn())
const handoverGet = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: staffMe },
      lineAccounts: { ...actual.api.lineAccounts, get: accountsGet, list: accountsList },
      accountHandovers: {
        ...actual.api.accountHandovers,
        listForAccount: handoversForAccount,
        get: handoverGet,
      },
    },
  }
})

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=account-1'),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

import HandoverPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const account = { id: 'account-1', name: '本店', channelId: 'ch-1' }

const detail = {
  id: 'h-1',
  fromAccountId: 'account-1',
  toAccountId: 'account-2',
  code: 'ABC123',
  status: 'linked',
  providerMatch: 'same',
  counts: { sourceTotal: 2, auto: 1, review: 1, unmatched: 0, lookalike: 0 },
  declaredFriendTotal: null,
  rollbackDeadline: null,
  rolledBackAt: null,
  linkedAt: '2026-09-28T00:00:00.000Z',
  decisions: [
    {
      id: 'd-1',
      from_friend_id: 'f-1',
      to_friend_id: 'f-2',
      decision: 'link',
      bucket: 'review',
      note: '名前が一致',
      sourceName: '山田',
      candidateName: '山田',
      evidenceLabel: '名前が一致',
    },
  ],
  unresolvedReviews: 1,
}

function buttons(): string[] {
  return [...host.querySelectorAll('button')].map((el) => el.textContent?.trim() ?? '')
}

beforeEach(() => {
  accountsGet.mockImplementation(async () => ({ success: true, data: account }))
  accountsList.mockImplementation(async () => ({
    success: true,
    data: [account, { id: 'account-2', name: '支店', channelId: 'ch-2' }],
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

describe('R522 引き継ぎの出し分け（役割×操作）', () => {
  it('進行中の引き継ぎがないとき、staff に発行・入力の入口が出ない', async () => {
    staffMe.mockImplementation(async () => ({ success: true, data: { role: 'staff' } }))
    handoversForAccount.mockImplementation(async () => ({ success: true, data: [] }))
    await act(async () => {
      root.render(<HandoverPage />)
    })
    await flush()

    const labels = buttons()
    expect(labels).not.toContain('引き継ぎコードを出す')
    expect(labels).not.toContain('コードを読む')
    expect(host.querySelector('input[aria-label="引き継ぎコード"]')).toBeNull()
    expect(host.textContent).toContain('引き継ぎの変更はオーナーと管理者だけができます')
  })

  it('進行中の引き継ぎがないとき、owner には発行・入力の入口が出る', async () => {
    staffMe.mockImplementation(async () => ({ success: true, data: { role: 'owner' } }))
    handoversForAccount.mockImplementation(async () => ({ success: true, data: [] }))
    await act(async () => {
      root.render(<HandoverPage />)
    })
    await flush()

    const labels = buttons()
    expect(labels).toContain('引き継ぎコードを出す')
    expect(labels).toContain('コードを読む')
    expect(host.querySelector('input[aria-label="引き継ぎコード"]')).not.toBeNull()
  })

  it('進行中の引き継ぎがあるとき、staff に事前確認・判断・本実行・取り消しが出ない', async () => {
    staffMe.mockImplementation(async () => ({ success: true, data: { role: 'staff' } }))
    handoversForAccount.mockImplementation(async () => ({ success: true, data: [{ id: 'h-1' }] }))
    handoverGet.mockImplementation(async () => ({ success: true, data: detail }))
    await act(async () => {
      root.render(<HandoverPage />)
    })
    await flush()

    const labels = buttons()
    expect(labels).not.toContain('事前確認をやり直す')
    expect(labels).not.toContain('本実行へ進む')
    expect(labels).not.toContain('引き継ぎを取り消す')
    expect(labels).not.toContain('判断を保存する')
    // 要確認の行は決めた内容だけ見せ、書き換えの選択肢は出さない。
    // 判断の選択肢は共通 Select（button＋listbox）で描く。
    expect(host.textContent).toContain('同じ人')
    expect(host.querySelector('button[aria-label="この人の判断"]')).toBeNull()
    expect(host.textContent).toContain('引き継ぎの変更はオーナーと管理者だけができます')
  })

  it('進行中の引き継ぎがあるとき、owner には事前確認・本実行・取り消しが出る', async () => {
    staffMe.mockImplementation(async () => ({ success: true, data: { role: 'owner' } }))
    handoversForAccount.mockImplementation(async () => ({ success: true, data: [{ id: 'h-1' }] }))
    handoverGet.mockImplementation(async () => ({ success: true, data: detail }))
    await act(async () => {
      root.render(<HandoverPage />)
    })
    await flush()

    const labels = buttons()
    expect(labels).toContain('事前確認をやり直す')
    expect(labels).toContain('本実行へ進む')
    expect(labels).toContain('引き継ぎを取り消す')
    expect(host.querySelector('button[aria-label="この人の判断"]')).not.toBeNull()
  })
})
