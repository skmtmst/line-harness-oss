// @vitest-environment happy-dom
/*
 * UX更新 A・B（アカウント引継ぎ V8）。
 * A: 読み込み中は骨組み（DelayedSkeleton＋aria-busy、読み込み中の文言なし）。
 * B: 判断の保存ボタンは 保存中→✓保存しました をボタンの内側だけで出す。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lineAccountsGet = vi.hoisted(() => vi.fn())
const lineAccountsList = vi.hoisted(() => vi.fn())
const staffMe = vi.hoisted(() => vi.fn())
const handoversListForAccount = vi.hoisted(() => vi.fn())
const handoversGet = vi.hoisted(() => vi.fn())
const handoversSaveDecisions = vi.hoisted(() => vi.fn())
const handoversExecute = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: staffMe },
      lineAccounts: { ...actual.api.lineAccounts, get: lineAccountsGet, list: lineAccountsList },
      accountHandovers: {
        ...actual.api.accountHandovers,
        listForAccount: handoversListForAccount,
        get: handoversGet,
        saveDecisions: handoversSaveDecisions,
        execute: handoversExecute,
      },
    },
  }
})

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=acc-1'),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...(p as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}))

vi.mock('@/components/step-up-prompt', () => ({
  useStepUpGate: () => ({ gate: async () => 'token', prompt: null }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

import HandoverV8 from './handover-v8'

function handoverDetail() {
  return {
    id: 'h1',
    status: 'previewed',
    code: 'ABC123',
    fromAccountId: 'acc-1',
    toAccountId: 'acc-2',
    providerMatch: 'same',
    counts: { sourceTotal: 14, auto: 10, review: 2, unmatched: 1, lookalike: 1 },
    decisions: [
      {
        id: 'd1',
        from_friend_id: 'f1',
        to_friend_id: 'f2',
        decision: 'link',
        bucket: 'review',
        note: null,
        sourceName: '高橋 直人',
        candidateName: '高橋 なおと',
        evidenceLabel: '電話番号が同じ',
      },
    ],
    unresolvedReviews: 1,
    declaredFriendTotal: null,
    rolledBackAt: null,
    rollbackDeadline: null,
    rollbackNote: null,
    linkedAt: '2026-10-01T00:00:00.000Z',
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  lineAccountsGet.mockReset()
  lineAccountsList.mockReset()
  staffMe.mockReset()
  handoversListForAccount.mockReset()
  handoversGet.mockReset()
  handoversSaveDecisions.mockReset()
  handoversExecute.mockReset()
  lineAccountsGet.mockResolvedValue({ success: true, data: { id: 'acc-1', name: '然-NEN-TEST' } })
  lineAccountsList.mockResolvedValue({ success: true, data: [{ id: 'acc-2', name: '然-NEN-本店' }] })
  staffMe.mockResolvedValue({ success: true, data: { role: 'owner' } })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

async function flush() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) {
      vi.advanceTimersByTime(100)
      await Promise.resolve()
      await Promise.resolve()
    }
  })
}

describe('引継ぎV8のUX（A骨組み・B保存ボタン）', () => {
  it('読み込み中は骨組みを出す（読み込み中の文言なし）', async () => {
    handoversListForAccount.mockReturnValue(new Promise(() => {}))
    await act(async () => { root.render(<HandoverV8 />) })
    expect(host.querySelector('[data-skeleton]')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(350) })
    const busy = host.querySelector('[aria-busy="true"]')
    expect(busy, 'aria-busyの枠がある').toBeTruthy()
    expect(busy?.getAttribute('aria-label')).toContain('読み込んでいます')
    expect(busy?.querySelector('[data-skeleton]'), '骨組みがある').toBeTruthy()
    expect(host.textContent).not.toContain('読み込み中')
  })

  it('判断の保存が成功するとボタンに✓保存しましたが出る', async () => {
    handoversListForAccount.mockResolvedValue({ success: true, data: [{ id: 'h1' }] })
    handoversGet.mockResolvedValue({ success: true, data: handoverDetail() })
    handoversSaveDecisions.mockResolvedValue({ success: true, data: {} })
    await act(async () => { root.render(<HandoverV8 />) })
    await flush()
    const selects = host.querySelectorAll('button[aria-label="この人の判断"]')
    await act(async () => { (selects[0] as HTMLButtonElement).click() })
    await flush()
    const option = [...document.querySelectorAll('[role="option"] button')].find((o) => o.textContent === '新しく作る') as HTMLElement
    await act(async () => { option!.click() })
    await flush()
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent === '判断を保存する') as HTMLButtonElement
    await act(async () => { save!.click() })
    await flush()
    expect(handoversSaveDecisions, '判断の保存を叩く').toHaveBeenCalled()
    const done = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('保存しました'))
    expect(done, '✓保存しましたがボタンの内側に出る').toBeTruthy()
  })
})
